import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Vorsteuer bei Eingangsbelegen nach Leistungsdatum (#693, Stufe 2): Abziehbar ist die Vorsteuer in dem Zeitraum, in dem
 * erstmalig beide Voraussetzungen erfüllt sind — die Leistung ist ausgeführt und eine Rechnung liegt vor (§ 15 Abs. 1
 * Satz 1 Nr. 1 UStG). Ist vor der Ausführung schon gezahlt, zählt sie im Monat der Zahlung (UStAE 15.3 Abs. 1 Satz 2).
 * Ohne Leistungsdatum bleibt es beim Belegdatum; ein Storno bleibt beim Stornodatum mit umgekehrtem Vorzeichen.
 */
describe.skipIf(!testDatabaseUrl)("Vorsteuer nach Leistungsdatum: Journal und Nebenbücher je Monat gleich (Nachprüfung #930)", () => {
  let figures: typeof import("./vat-figures.ts");
  let bank: typeof import("../bank/index.ts");
  let documents: typeof import("../belege/documents.ts");
  let cancellation: typeof import("../belege/cancellation.ts");
  let sql: postgres.Sql;
  const actor = "leistungsdatum-review";
  let lauf = 0;
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 93]);

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("./vat-figures.ts");
    bank = await import("../bank/index.ts");
    documents = await import("../belege/documents.ts");
    cancellation = await import("../belege/cancellation.ts");
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

    it(`${n} Skonto vor der Ausführung, danach aufgehoben, dann Storno: Nebenbücher nehmen auch die Aufhebung zurück`, async () => {
      await firma({ journalAb: 2026, ...p });
      const id = await beleg({ datum: "2026-09-01", von: "2026-10-01", bis: "2026-10-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
      const z = await zahlung(id, -3_779, "2026-09-10");
      await bank.writeOff(actor, { kind: "skontoErhalten", documentId: id, date: "2026-09-10" });
      const [w] = await sql`select id from write_offs where document_id = ${id}`;
      await bank.reverseWriteOff(actor, w!.id as string, "2026-11-05");
      await cancellation.cancelDocument(actor, id, { reason: "falsch", allocationIds: [z] }, "2026-11-10");
      const q = await beideQuellen(M([2026, 9], 3));
      const [st] = await sql`select date::text as date from document_cancellations where document_id = ${id}`;
      expect({
        storno: st!.date,
        journal: q.journal,
        nebenbuecher: q.nebenbuecher,
        summeNebenbuecher: q.nebenbuecher.reduce((a, b) => a! + b!, 0),
        zw: await zw(),
      }).toEqual({
        storno: st!.date,
        journal: q.journal,
        nebenbuecher: q.journal,
        summeNebenbuecher: 0,
        zw: 0,
      });
    });

    it(`${n} Kursdifferenz (Fremdwährung) vor der Ausführung bewegt keine Vorsteuer, ihr Anteil kommt mit der Ausführung`, async () => {
      await firma({ journalAb: 2026, ...p });
      const id = await beleg({
        datum: "2026-10-20",
        von: "2026-12-01",
        bis: "2026-12-31",
        amounts: [{ taxRate: 1900, net: 0, tax: 0, originalNet: 100_000, originalTax: 19_000 }],
        extra: { currency: "USD", exchangeRate: "1,0812" },
      });
      const [doc] = await sql`select net, tax, gross from documents where id = ${id}`;
      const offen = Math.abs(doc!.gross as number);
      const umsatz = await bankumsatz(-(offen - 2_000), "2026-11-05");
      const rw = await rueckwirkend("2026-11-05", () =>
        bank.allocateWithRest(actor, { transactionId: umsatz, target: { kind: "document", documentId: id }, rest: "kursdifferenz" }),
      );
      const q = await beideQuellen(M([2026, 10], 4));
      expect({ ...q, zw: await zw(), rw, summe: q.journal.reduce((a, b) => a + b, 0) }).toEqual({
        journal: q.journal,
        nebenbuecher: q.journal,
        zw: 0,
        rw: [],
        summe: doc!.tax,
      });
      // Die Zahlung zieht ihren Anteil im November, der Anteil der Kursdifferenz kommt mit der Ausführung im Dezember
      // (§ 16 Abs. 6, § 15 Abs. 1 Satz 1 Nr. 1 Satz 3 UStG; Entscheidung des Maintainers in #930)
      expect(q.journal).toEqual([0, 17_254, 319, 0]);
    });

    it(`${n} Kursdifferenz nach der Ausführung: die ganze Vorsteuer bleibt im Monat der Ausführung`, async () => {
      await firma({ journalAb: 2026, ...p });
      const id = await beleg({
        datum: "2026-10-20",
        von: "2026-11-01",
        bis: "2026-11-30",
        amounts: [{ taxRate: 1900, net: 0, tax: 0, originalNet: 100_000, originalTax: 19_000 }],
        extra: { currency: "USD", exchangeRate: "1,0812" },
      });
      const [doc] = await sql`select gross, tax from documents where id = ${id}`;
      const umsatz = await bankumsatz(-(Math.abs(doc!.gross as number) - 2_000), "2026-12-05");
      await bank.allocateWithRest(actor, { transactionId: umsatz, target: { kind: "document", documentId: id }, rest: "kursdifferenz" });
      const q = await beideQuellen(M([2026, 10], 3));
      expect({ ...q, zw: await zw() }).toEqual({ journal: [0, doc!.tax, 0], nebenbuecher: [0, doc!.tax, 0], zw: 0 });
    });

    // Vorkasse vor dem Rechnungsdatum: abziehbar erst, wenn Rechnung und Zahlung vorliegen (§ 15 Abs. 1 Satz 1 Nr. 1
    // Satz 3 UStG; UStAE 15.3 Abs. 1 Satz 2: Zeitraum, in dem erstmalig beide Voraussetzungen erfüllt sind), also im
    // Monat der Rechnung, nicht im Monat der Zahlung. Gefunden in der Selbstprüfung von TheLord83, Frage 2
    it(`${n} Zahlung vor dem Rechnungsdatum: Vorsteuer im Monat der Rechnung, Journal wie Nebenbücher`, async () => {
      await firma({ journalAb: 2026, ...p });
      const id = await beleg({ datum: "2026-11-02", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
      await zahlung(id, -3_856, "2026-10-30");
      const q = await beideQuellen(M([2026, 10], 3));
      expect({ ...q, zw: await zw() }).toEqual({ journal: [0, 616, 0], nebenbuecher: [0, 616, 0], zw: 0 });
    });

    // Aufhebung einer Vorkasse vor dem Rechnungsdatum nach Abgabe des Rechnungsmonats: Die Gegenbuchung wirkt am Tag der
    // Aufhebung, nicht rückwirkend im schon gemeldeten Monat (#782; GoBD: keine Änderung abgeschlossener Zeiträume, wie bei
    // der Zahlung nach dem Rechnungsdatum). Gefunden im Review von #930
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

    // Vorkasse im Dezember, Rechnung im Januar: Kz 66 im Januar (UStAE 15.3 Abs. 1 Satz 2), in der EÜR bleibt die
    // gezahlte Vorsteuer Betriebsausgabe im Jahr der Zahlung (§ 11 Abs. 2 EStG). Review #930
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
    // mit der Ausführung (UStAE 15.3 Abs. 1 Satz 2 und Abs. 4). Review #930
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
    // Review #930
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

    // Altbestand aus v0.9.0 (#879): Belege mit Leistungszeitraum, die vor diesem Stand gebucht wurden, haben die Vorsteuer
    // im Journal am Belegdatum, ohne Zwischenkonto. Die Nebenbücher dürfen sie nicht nachträglich verschieben, sonst
    // ändert ein Update schon gemeldete Monate und Journal und Gegenprobe fallen auseinander. Nachweis ist die Buchung,
    // wie in vorsteuer-ausgleich.ts („ein nachträglich gesetztes Leistungsdatum bucht nicht rückwirkend um“).
    // Gefunden in der Selbstprüfung von TheLord83, Frage 1
    it(`${n} Altbestand: vor diesem Stand gebuchter Beleg mit Leistungszeitraum bleibt im Belegmonat, Journal wie Nebenbücher`, async () => {
      await firma({ journalAb: 2026, ...p });
      const id = await beleg({ datum: "2026-11-20", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
      // So stand ein solcher Beleg nach v0.9.0 in der Datenbank: Leistungszeitraum am Beleg, Buchung ohne Zwischenkonto
      await sql.begin(async (t) => {
        await t`set local session_replication_role = replica`;
        await t`update documents set service_from = '2026-12-01', service_to = '2026-12-31' where id = ${id}`;
      });
      const q = await beideQuellen(M([2026, 11], 2));
      expect({ ...q, zw: await zw() }).toEqual({ journal: [616, 0], nebenbuecher: [616, 0], zw: 0 });
    });

    it(`${n} Privatanteil, zwei Steuersätze, Teilzahlung vor der Ausführung: kumuliert gerundet`, async () => {
      await firma({ journalAb: 2026, ...p });
      const id = await beleg({
        datum: "2026-08-20",
        von: "2026-09-01",
        bis: "2026-09-30",
        privateShare: 33,
        amounts: [
          { taxRate: 1900, net: 3_240, tax: 616 },
          { taxRate: 700, net: 1_001, tax: 70 },
        ],
      });
      await zahlung(id, -1_003, "2026-08-25");
      const q = await beideQuellen(M([2026, 8], 2));
      expect({ ...q, zw: await zw() }).toEqual({ journal: q.journal, nebenbuecher: q.journal, zw: 0 });
    });
  }
});
