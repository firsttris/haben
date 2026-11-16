import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Vorkasse vor dem Rechnungsdatum bei einem Leistungsdatum nach dem Belegdatum (#693): Abziehbar ist die Vorsteuer erst,
 * wenn Rechnung und Zahlung vorliegen (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 3 UStG; UStAE 15.3 Abs. 1 Satz 2), also frühestens
 * im Monat der Rechnung. Eine Aufhebung wirkt an ihrem Tag, nicht rückwirkend (#782). Je Kontenrahmen und Versteuerung;
 * Journal und Nebenbücher müssen je Monat gleich sein.
 */
describe.skipIf(!testDatabaseUrl)("Vorsteuer nach Leistungsdatum: Zahlung vor dem Rechnungsdatum (#693)", () => {
  let figures: typeof import("./vat-figures.ts");
  let bank: typeof import("../bank/index.ts");
  let documents: typeof import("../belege/documents.ts");
  let sql: postgres.Sql;
  const actor = "leistungsdatum-vorkasse";
  let lauf = 0;
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 93]);

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("./vat-figures.ts");
    bank = await import("../bank/index.ts");
    documents = await import("../belege/documents.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Firma mit Journal ab `journalAb`: dann kommt Kz 66 aus dem Journal, die Nebenbücher sind die Gegenprobe */
  async function firma(optionen: { kleinunternehmer?: boolean; journalAb?: number; kontenrahmen?: "SKR03" | "SKR04"; versteuerung?: "ist" | "soll" } = {}) {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, vat_return_submissions, year_closings,
      write_offs, allocations, cash_entries, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, document_splits, documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, kleinunternehmer, payment_term_days, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${optionen.versteuerung ?? "ist"}, ${optionen.kontenrahmen ?? "SKR03"}, 'einzelunternehmen',
              ${optionen.kleinunternehmer ?? false}, 14, ${optionen.journalAb ?? 2030})`;
  }

  type Betrag = { taxRate: 700 | 1900; net: number; tax: number };

  /** Gebuchter Eingangsbeleg; Leistungszeitraum nur, wenn angegeben */
  async function beleg(input: {
    datum: string;
    amounts: (Betrag & { originalNet?: number; originalTax?: number })[];
    von?: string | null;
    bis?: string | null;
    privateShare?: number;
    payment?: "bank" | "kasse" | "privat";
    erstattetBezahltes?: boolean;
    extra?: Record<string, unknown>;
  }) {
    lauf++;
    const bytes = new Uint8Array([...JPEG, lauf % 251, Math.floor(lauf / 251)]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Stadtwerke Beispiel GmbH",
      supplierUstId: "",
      invoiceNumber: `B-${lauf}`,
      documentDate: input.datum,
      dueDate: null,
      serviceFrom: input.von ?? null,
      serviceTo: input.bis ?? null,
      category: "edv",
      payment: input.payment ?? "bank",
      note: "",
      privateShare: input.privateShare ?? 0,
      amounts: input.amounts,
      ...(input.extra ?? {}),
      ...(input.erstattetBezahltes === undefined ? {} : { erstattetBezahltes: input.erstattetBezahltes }),
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Echter Bankumsatz mit einem Betrag (Cent, negativ = Ausgang); gibt die Umsatz-Id zurück */
  async function bankumsatz(betrag: number, datum: string) {
    const euro = (Math.abs(betrag) / 100).toFixed(2).replace(".", ",");
    const [jahr, monat, tag] = datum.split("-");
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${tag}.${monat}.${jahr!.slice(2)}";"${tag}.${monat}.${jahr!.slice(2)}";"Gebucht";"Stadtwerke Beispiel GmbH";"Testfirma";"Abschlag";"${betrag < 0 ? "Ausgang" : "Eingang"}";"DE02100100100006820101";"${betrag < 0 ? "-" : ""}${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `zahlung-${++lauf}.csv` }, null);
    const [umsatz] = await sql`select id from bank_transactions order by created_at desc limit 1`;
    return umsatz!.id as string;
  }

  /** Bankumsatz und Zuordnung auf den Beleg */
  async function zahlung(documentId: string, betrag: number, datum: string) {
    const umsatz = await bankumsatz(betrag, datum);
    await bank.allocate(actor, { kind: "document", transactionId: umsatz, documentId, amount: betrag });
    const [zuordnung] = await sql`select id from allocations where transaction_id = ${umsatz} and reverses_id is null`;
    return zuordnung!.id as string;
  }

  /** Kz 66 je Monat aus dem Journal und aus den Nebenbüchern (Gegenprobe) */
  async function beideQuellen(monate: { year: number; month: number }[]) {
    const journal: number[] = [];
    const nebenbuecher: (number | undefined)[] = [];
    for (const m of monate) {
      const f = await figures.computeVatFigures(m);
      journal.push(f.kz66);
      nebenbuecher.push(f.nebenbuecher?.kz66);
    }
    return { journal, nebenbuecher };
  }
  /** Saldo des Zwischenkontos (SKR03 1548, SKR04 1434) über alle Buchungen */
  async function zw() {
    const [z] = await sql`select coalesce(sum(debit - credit), 0)::int as saldo from journal_lines where account in ('1548', '1434')`;
    return z!.saldo as number;
  }
  /** Buchungen, die ein Ereignis vor seinem eigenen Tag anlegt (rückwirkend) */
  async function rueckwirkend(datum: string, fn: () => Promise<unknown>) {
    const vorher = new Set((await sql`select id from journal_entries`).map((r) => r.id as string));
    await fn();
    const neu = await sql`select id, date::text as date, description from journal_entries`;
    return neu.filter((r) => !vorher.has(r.id as string) && (r.date as string) < datum).map((r) => `${r.date} ${r.description}`);
  }
  /** n Monate ab `von` (Jahr, Monat) */
  const M = (von: [number, number], n: number) =>
    Array.from({ length: n }, (_, i) => {
      const m = von[1] - 1 + i;
      return { year: von[0] + Math.floor(m / 12), month: (m % 12) + 1 };
    });

  for (const p of [
    { kontenrahmen: "SKR03" as const, versteuerung: "ist" as const },
    { kontenrahmen: "SKR04" as const, versteuerung: "soll" as const },
  ]) {
    const n = `${p.kontenrahmen}/${p.versteuerung}`;

    // Vorkasse vor dem Rechnungsdatum: abziehbar erst, wenn Rechnung und Zahlung vorliegen (§ 15 Abs. 1 Satz 1 Nr. 1
    // Satz 3 UStG; UStAE 15.3 Abs. 1 Satz 2: Zeitraum, in dem erstmalig beide Voraussetzungen erfüllt sind), also im
    // Monat der Rechnung, nicht im Monat der Zahlung
    it(`${n} Zahlung vor dem Rechnungsdatum: Vorsteuer im Monat der Rechnung, Journal wie Nebenbücher`, async () => {
      await firma({ journalAb: 2026, ...p });
      const id = await beleg({ datum: "2026-11-02", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
      await zahlung(id, -3_856, "2026-10-30");
      const q = await beideQuellen(M([2026, 10], 3));
      expect({ ...q, zw: await zw() }).toEqual({ journal: [0, 616, 0], nebenbuecher: [0, 616, 0], zw: 0 });
    });

    // Aufhebung einer Vorkasse vor dem Rechnungsdatum nach Abgabe des Rechnungsmonats: Die Gegenbuchung wirkt am Tag der
    // Aufhebung, nicht rückwirkend im schon gemeldeten Monat (#782; GoBD: keine Änderung abgeschlossener Zeiträume, wie bei
    // der Zahlung nach dem Rechnungsdatum)
    for (const zahltag of ["2026-11-05", "2026-10-30"]) {
      it(`${n} Zahlung am ${zahltag}, Rechnung 02.11., am 10.12. aufgehoben: November bleibt, nichts rückwirkend`, async () => {
        await firma({ journalAb: 2026, ...p });
        const id = await beleg({ datum: "2026-11-02", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
        const z = await zahlung(id, -3_856, zahltag);
        const rw = await rueckwirkend("2026-12-10", () => bank.reverseAllocation(actor, z, "2026-12-10"));
        const q = await beideQuellen(M([2026, 10], 3));
        expect({ ...q, zw: await zw(), rw }).toEqual({ journal: [0, 616, 0], nebenbuecher: [0, 616, 0], zw: 0, rw: [] });
      });
    }

    // Nachgereichte Teilzahlung nach der Aufhebung einer anderen: Die Gegenbuchung der Aufhebung (10.12.) liegt nach dem Tag
    // der nachgereichten Zahlung (20.11.), ist aber schon gebucht und zählt mit. Sonst zieht die Zahlung nichts, Kz 66
    // November fehlt ihr Anteil und Journal und Nebenbücher laufen auseinander (UStAE 15.3 Abs. 1 Satz 2)
    it(`${n} Teilzahlung vor der Rechnung am 10.12. aufgehoben, danach Teilzahlung vom 20.11. nachgereicht`, async () => {
      await firma({ journalAb: 2026, ...p });
      const id = await beleg({ datum: "2026-11-02", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
      const z = await zahlung(id, -1_928, "2026-10-30");
      await bank.reverseAllocation(actor, z, "2026-12-10");
      await zahlung(id, -1_928, "2026-11-20");
      const q = await beideQuellen(M([2026, 10], 3));
      expect({ ...q, zw: await zw() }).toEqual({ journal: [0, 616, 0], nebenbuecher: [0, 616, 0], zw: 0 });
    });

    // Vorkasse im Dezember, Rechnung im Januar: Kz 66 im Januar (UStAE 15.3 Abs. 1 Satz 2), in der EÜR bleibt die
    // gezahlte Vorsteuer Betriebsausgabe im Jahr der Zahlung (§ 11 Abs. 2 EStG)
    it(`${n} Zahlung im Dezember, Rechnung im Januar: Kz 66 im Januar, EÜR im Jahr der Zahlung`, async () => {
      await firma({ journalAb: 2026, ...p });
      const euer = await import("../auswertungen/euer-journal.ts");
      const id = await beleg({ datum: "2027-01-05", von: "2027-02-01", bis: "2027-02-28", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
      await zahlung(id, -3_856, "2026-12-15");
      const q = await beideQuellen(M([2026, 12], 3));
      const e2026 = (await euer.euerAusJournal(2026)).summe.zeilen;
      const e2027 = (await euer.euerAusJournal(2027)).summe.zeilen;
      expect({ ...q, zw: await zw(), vst2026: e2026.vorsteuer, vst2027: e2027.vorsteuer }).toEqual({
        journal: [0, 616, 0],
        nebenbuecher: [0, 616, 0],
        zw: 0,
        vst2026: 616,
        vst2027: undefined,
      });
    });

    // Teilzahlungen vor und nach dem Rechnungsdatum: je Zahlung ihr Anteil, frühestens im Monat der Rechnung, der Rest
    // mit der Ausführung (UStAE 15.3 Abs. 1 Satz 2 und Abs. 4)
    it(`${n} Teilzahlungen vor und nach dem Rechnungsdatum: kumuliert im Monat der Rechnung, Rest mit der Ausführung`, async () => {
      await firma({ journalAb: 2026, ...p });
      const id = await beleg({ datum: "2026-11-02", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
      await zahlung(id, -1_928, "2026-10-30");
      const a = await beideQuellen(M([2026, 10], 3));
      await zahlung(id, -1_000, "2026-10-31");
      const b = await beideQuellen(M([2026, 10], 3));
      await zahlung(id, -928, "2026-11-20");
      const c = await beideQuellen(M([2026, 10], 3));
      expect({ a, b, c, zw: await zw() }).toEqual({
        a: { journal: [0, 308, 308], nebenbuecher: [0, 308, 308] },
        b: { journal: [0, 468, 148], nebenbuecher: [0, 468, 148] },
        c: { journal: [0, 616, 0], nebenbuecher: [0, 616, 0] },
        zw: 0,
      });
    });

    // Vorkasse mit Skonto vor dem Rechnungsdatum: Der Skonto mindert die Vorsteuer (§ 17 Abs. 1 Satz 2 UStG), der Rest
    // zählt im Monat der Rechnung (UStAE 15.3 Abs. 1 Satz 2). „Zahlung mit Skonto“ bucht den Skonto am Tag des Umsatzes.
    it(`${n} Vorkasse mit Skonto am Zahltag vor dem Rechnungsdatum: bucht, Vorsteuer ohne Skonto im Monat der Rechnung`, async () => {
      await firma({ journalAb: 2026, ...p });
      const id = await beleg({ datum: "2026-11-02", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
      const umsatz = await bankumsatz(-3_779, "2026-10-30");
      await bank.allocateWithRest(actor, { transactionId: umsatz, target: { kind: "document", documentId: id }, rest: "skontoErhalten" });
      const q = await beideQuellen(M([2026, 10], 3));
      expect({ ...q, zw: await zw() }).toEqual({ journal: [0, 604, 0], nebenbuecher: [0, 604, 0], zw: 0 });
    });

    it(`${n} Vorkasse vor dem Rechnungsdatum, Skonto danach: Vorsteuer ohne Skonto im Monat der Rechnung`, async () => {
      await firma({ journalAb: 2026, ...p });
      const id = await beleg({ datum: "2026-11-02", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
      await zahlung(id, -3_779, "2026-10-30");
      await bank.writeOff(actor, { kind: "skontoErhalten", documentId: id, date: "2026-11-05" });
      const q = await beideQuellen(M([2026, 10], 3));
      expect({ ...q, zw: await zw() }).toEqual({ journal: [0, 604, 0], nebenbuecher: [0, 604, 0], zw: 0 });
    });
  }
});
