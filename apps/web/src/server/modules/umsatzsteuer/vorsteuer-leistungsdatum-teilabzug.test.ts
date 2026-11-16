import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Leistungsdatum nach dem Belegdatum (#693) zusammen mit anteiligem Vorsteuerabzug (#926): Abziehbar ist nur der
 * wirtschaftlich zugeordnete Teil (§ 15 Abs. 4 UStG), und auch der erst, wenn Leistung und Rechnung vorliegen oder
 * vorher gezahlt ist (§ 15 Abs. 1 Satz 1 Nr. 1 UStG, UStAE 15.3). Geparkt und freigegeben wird deshalb nur der
 * abziehbare Teil; der Rest ist mit dem Buchen Aufwand. Je Kontenrahmen und Versteuerung: Kz 66 aus Journal und
 * Nebenbüchern je Monat gleich, das Zwischenkonto endet bei 0, der Aufwand trägt den nicht abziehbaren Teil.
 */
describe.skipIf(!testDatabaseUrl)("Vorsteuer nach Leistungsdatum mit Teilabzug (#693, #926)", () => {
  let figures: typeof import("./vat-figures.ts");
  let bank: typeof import("../bank/index.ts");
  let documents: typeof import("../belege/documents.ts");
  let cancellation: typeof import("../belege/cancellation.ts");
  let sql: postgres.Sql;
  const actor = "leistungsdatum-teilabzug";
  let lauf = 0;
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 94]);

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

  async function firma(p: { kontenrahmen: "SKR03" | "SKR04"; versteuerung: "ist" | "soll" }) {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, vat_return_submissions, year_closings,
      write_offs, allocations, cash_entries, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, document_splits, documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, kleinunternehmer, payment_term_days, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${p.versteuerung}, ${p.kontenrahmen}, 'einzelunternehmen', false, 14, 2026)`;
  }

  type Betrag = { taxRate: 700 | 1900; net: number; tax: number; vorsteuerAnteil?: number | null };

  /** 100 € netto zu 19 %, 50 % abziehbar: 9,50 € Vorsteuer, 109,50 € Aufwand */
  const HALB: Betrag[] = [{ taxRate: 1900, net: 10_000, tax: 1_900 }];
  /** Zwei Sätze mit eigenem Anteil: 50 % von 19,00 € = 9,50 €, 25 % von 2,10 € = 0,53 € (kaufmännisch gerundet) */
  const ZWEI: Betrag[] = [
    { taxRate: 1900, net: 10_000, tax: 1_900, vorsteuerAnteil: 5_000 },
    { taxRate: 700, net: 3_000, tax: 210, vorsteuerAnteil: 2_500 },
  ];

  /** Gebuchter Eingangsbeleg vom 01.09., Leistung im Oktober, 50 % Abzug am Beleg */
  async function beleg(amounts: Betrag[] = HALB) {
    lauf++;
    const bytes = new Uint8Array([...JPEG, lauf % 251, Math.floor(lauf / 251)]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `teilabzug-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Stadtwerke Beispiel GmbH",
      supplierUstId: "",
      invoiceNumber: `T-${lauf}`,
      documentDate: "2026-09-01",
      dueDate: null,
      serviceFrom: "2026-10-01",
      serviceTo: "2026-10-31",
      category: "edv",
      payment: "bank",
      note: "",
      privateShare: 0,
      vorsteuerAnteil: 5_000,
      amounts,
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  async function bankumsatz(betrag: number, datum: string) {
    const euro = (Math.abs(betrag) / 100).toFixed(2).replace(".", ",");
    const [jahr, monat, tag] = datum.split("-");
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${tag}.${monat}.${jahr!.slice(2)}";"${tag}.${monat}.${jahr!.slice(2)}";"Gebucht";"Stadtwerke Beispiel GmbH";"Testfirma";"Abschlag";"Ausgang";"DE02100100100006820101";"-${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `zahlung-${++lauf}.csv` }, null);
    const [umsatz] = await sql`select id from bank_transactions order by created_at desc limit 1`;
    return umsatz!.id as string;
  }

  async function zahlung(documentId: string, betrag: number, datum: string) {
    const umsatz = await bankumsatz(betrag, datum);
    await bank.allocate(actor, { kind: "document", transactionId: umsatz, documentId, amount: betrag });
    const [zuordnung] = await sql`select id from allocations where transaction_id = ${umsatz} and reverses_id is null`;
    return zuordnung!.id as string;
  }

  /** August bis Dezember 2026 */
  const MONATE = [8, 9, 10, 11, 12].map((month) => ({ year: 2026, month }));

  /** Kz 66 je Monat aus Journal und Nebenbüchern, Saldo des Zwischenkontos, Aufwand der Belegbuchung */
  async function stand(documentId: string) {
    const journal: number[] = [];
    const nebenbuecher: (number | undefined)[] = [];
    for (const m of MONATE) {
      const f = await figures.computeVatFigures(m);
      journal.push(f.kz66);
      nebenbuecher.push(f.nebenbuecher?.kz66);
    }
    const [z] = await sql`select coalesce(sum(debit - credit), 0)::int as saldo from journal_lines where account in ('1548', '1434')`;
    const [a] = await sql`select coalesce(sum(l.debit - l.credit), 0)::int as aufwand from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'document' and e.source_id = ${documentId} and e.reverses_id is null and l.account in ('4806', '6495')`;
    return { journal, nebenbuecher, zw: z!.saldo as number, aufwand: a!.aufwand as number };
  }

  /** Erwartung: dieselben Kz 66 in beiden Quellen, Zwischenkonto 0, Aufwand = Netto + nicht abziehbare Steuer */
  const erwartet = (kz66: number[], aufwand = 10_950) => ({ journal: kz66, nebenbuecher: kz66, zw: 0, aufwand });

  for (const p of [
    { kontenrahmen: "SKR03" as const, versteuerung: "ist" as const },
    { kontenrahmen: "SKR04" as const, versteuerung: "soll" as const },
  ]) {
    const n = `${p.kontenrahmen}/${p.versteuerung}`;

    it(`${n} nie bezahlt: nur der abziehbare Teil wird im Monat der Ausführung frei, der Rest ist Aufwand`, async () => {
      await firma(p);
      const id = await beleg();
      expect(await stand(id)).toEqual(erwartet([0, 0, 950, 0, 0]));
    });

    it(`${n} Vorkasse vor dem Rechnungsdatum: abziehbarer Teil im Monat der Rechnung`, async () => {
      await firma(p);
      const id = await beleg();
      await zahlung(id, -11_900, "2026-08-20");
      expect(await stand(id)).toEqual(erwartet([0, 950, 0, 0, 0]));
    });

    // Kumuliert gerundet: 3.000 von 11.900 ziehen 479 Steuer, davon 50 % = 240; nach 5.000 sind es 798, davon 399
    it(`${n} Teilzahlungen vor der Ausführung: je Zahlung ihr abziehbarer Anteil, Rest mit der Ausführung`, async () => {
      await firma(p);
      const id = await beleg();
      await zahlung(id, -3_000, "2026-09-10");
      await zahlung(id, -2_000, "2026-09-20");
      expect(await stand(id)).toEqual(erwartet([0, 399, 551, 0, 0]));
    });

    // Skonto 2 % (238 brutto, 38 Steuer): Davon waren 19 abziehbar und noch nicht abgezogen; die Zahlung zieht 931
    it(`${n} Zahlung mit Skonto vor der Ausführung: Skonto mindert nur den abziehbaren Teil auf dem Zwischenkonto`, async () => {
      await firma(p);
      const id = await beleg();
      const umsatz = await bankumsatz(-11_662, "2026-09-10");
      await bank.allocateWithRest(actor, { transactionId: umsatz, target: { kind: "document", documentId: id }, rest: "skontoErhalten" });
      expect(await stand(id)).toEqual(erwartet([0, 931, 0, 0, 0]));
    });

    it(`${n} Zahlung vor der Ausführung aufgehoben: Monat der Zahlung gleicht aus, Freigabe mit der Ausführung`, async () => {
      await firma(p);
      const id = await beleg();
      const z = await zahlung(id, -11_900, "2026-09-15");
      await bank.reverseAllocation(actor, z, "2026-09-20");
      expect(await stand(id)).toEqual(erwartet([0, 0, 950, 0, 0]));
    });

    // Nichts gemeldet: Die Gegenbuchung kommt auf das Belegdatum (cancellationDate), Zahlung und Freigabe heben sich dort
    // mit dem abziehbaren Teil auf, das Zwischenkonto bleibt bei 0
    it(`${n} Storno nach der Ausführung, bezahlt vor ihr: nimmt genau den abziehbaren Teil zurück`, async () => {
      await firma(p);
      const id = await beleg();
      const z = await zahlung(id, -11_900, "2026-09-15");
      await cancellation.cancelDocument(actor, id, { reason: "falscher Beleg", allocationIds: [z] }, "2026-11-10");
      expect(await stand(id)).toEqual(erwartet([0, 0, 0, 0, 0]));
    });

    it(`${n} zwei Steuersätze mit eigenem Anteil, nie bezahlt: 950 + 53 im Monat der Ausführung`, async () => {
      await firma(p);
      const id = await beleg(ZWEI);
      expect(await stand(id)).toEqual(erwartet([0, 0, 1_003, 0, 0], 13_000 + 950 + 157));
    });

    // 7.555 von 15.110 brutto: je Satz die Hälfte der Steuer (950 und 105), davon 50 % bzw. 25 % = 475 und 26
    it(`${n} zwei Steuersätze, Teilzahlung vor der Ausführung: je Satz kumuliert gerundet`, async () => {
      await firma(p);
      const id = await beleg(ZWEI);
      await zahlung(id, -7_555, "2026-09-15");
      expect(await stand(id)).toEqual(erwartet([0, 501, 502, 0, 0], 13_000 + 950 + 157));
    });
  }
});
