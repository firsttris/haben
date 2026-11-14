import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Vorsteuer bei Eingangsbelegen nach Leistungsdatum (#693, Stufe 2): Abziehbar ist die Vorsteuer in dem Zeitraum, in dem
 * erstmalig beide Voraussetzungen erfüllt sind — die Leistung ist ausgeführt und eine Rechnung liegt vor (§ 15 Abs. 1
 * Satz 1 Nr. 1 UStG). Ist vor der Ausführung schon gezahlt, zählt sie im Monat der Zahlung (UStAE 15.3 Abs. 1 Satz 2).
 * Ohne Leistungsdatum bleibt es beim Belegdatum; ein Storno bleibt beim Stornodatum mit umgekehrtem Vorzeichen.
 */
describe.skipIf(!testDatabaseUrl)("Vorsteuer nach Leistungsdatum, Review (#930)", () => {
  let figures: typeof import("./vat-figures.ts");
  let bank: typeof import("../bank/index.ts");
  let documents: typeof import("../belege/documents.ts");
  let sql: postgres.Sql;
  const actor = "leistungsdatum-review";
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

  /**
   * Firma vor dem Stichjahr: Die Kennzahlen kommen aus den Nebenbüchern, dort entscheidet die Zuordnung. Im Zeitraum ab
   * dem Stichjahr rechnet Haben aus dem Journal; das folgt mit der Buchungsseite (Zwischenkonto, #693).
   */
  async function firma(optionen: { kleinunternehmer?: boolean; journalAb?: number } = {}) {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, vat_return_submissions, year_closings,
      write_offs, allocations, cash_entries, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, document_splits, documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, kleinunternehmer, payment_term_days, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03', 'einzelunternehmen',
              ${optionen.kleinunternehmer ?? false}, 14, ${optionen.journalAb ?? 2030})`;
  }

  type Betrag = { taxRate: 700 | 1900; net: number; tax: number };

  /** Gebuchter Eingangsbeleg; Leistungszeitraum nur, wenn angegeben */
  async function beleg(input: {
    datum: string;
    amounts: Betrag[];
    von?: string | null;
    bis?: string | null;
    privateShare?: number;
    payment?: "bank" | "kasse" | "privat";
    erstattetBezahltes?: boolean;
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

  /** Vorsteuer (Kz 66) und die Zeilen dahinter für einen Monat */
  async function monat(month: number, year = 2026) {
    const f = await figures.computeVatFigures({ year, month });
    return { kz66: f.kz66, zeilen: f.inputTax.map((a) => ({ date: a.date, tax: a.tax, base: a.base })) };
  }

  // § 15 Abs. 1 Satz 1 Nr. 1 Satz 1 UStG: Leistung ausgeführt und Rechnung liegt vor; UStAE 15.2 Abs. 2 Satz 7 bzw. 15.3
  // Abs. 1 Satz 2: abziehbar im Zeitraum, in dem beide Voraussetzungen erstmals erfüllt sind (Akzeptanzkriterium in #693)
  it("Rechnung vor der Leistung, unbezahlt bis zur Ausführung: Vorsteuer im Monat der Ausführung", async () => {
    await firma();
    await beleg({ datum: "2026-11-20", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });

    expect((await monat(11)).kz66).toBe(0);
    expect((await monat(12)).kz66).toBe(616);
    expect((await monat(1, 2027)).kz66).toBe(0);
  });

  // Beispiel aus #693, Vorschlag 4: Wartung 15.11. bis 14.12., Rechnung 20.11., bezahlt 10.01. → Vorsteuer im Dezember
  it("nach der Ausführung bezahlt: Vorsteuer im Monat der Ausführung, nicht der Zahlung", async () => {
    await firma();
    const id = await beleg({ datum: "2026-11-20", von: "2026-11-15", bis: "2026-12-14", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    await zahlung(id, -3_856, "2027-01-10");

    expect((await monat(11)).kz66).toBe(0);
    expect((await monat(12)).kz66).toBe(616);
    expect((await monat(1, 2027)).kz66).toBe(0);
  });

  // Aufgehobene Zuordnung wirkt am Tag der Aufhebung (allocations.date, #782, docs/bank.md „Zuordnung aufheben“), nicht
  // rückwirkend im Monat der Zahlung: Der Dezember kann schon gemeldet sein
  it("aufgehobene Zuordnung ändert den Monat der Zahlung nicht rückwirkend", async () => {
    await firma();
    const id = await beleg({ datum: "2026-08-20", von: "2027-03-01", bis: "2027-03-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    const zuordnung = await zahlung(id, -3_856, "2026-09-05");
    expect((await monat(9)).kz66).toBe(616);

    await bank.reverseAllocation(actor, zuordnung, "2026-10-10");

    expect((await monat(9)).kz66).toBe(616);
    expect((await monat(10)).kz66).toBe(-616);
  });

  // Eine Gutschrift berichtigt nach § 17 Abs. 1 UStG im Zeitraum der Änderung; ohne „erstattet bereits Bezahltes“ gilt
  // das Belegdatum (docs/umsatzsteuer.md, Vorsteuer). Ein Leistungszeitraum, etwa aus BT-73/74 der E-Rechnung, ändert daran nichts
  it("Gutschrift mit Leistungszeitraum nach dem Belegdatum mindert im Belegmonat", async () => {
    await firma();
    await beleg({
      datum: "2026-03-15",
      von: "2026-01-01",
      bis: "2026-12-31",
      erstattetBezahltes: false,
      amounts: [{ taxRate: 1900, net: -1_000, tax: -190 }],
    });

    expect((await monat(3)).kz66).toBe(-190);
    expect((await monat(12)).kz66).toBe(0);
  });

  // Ab dem Stichjahr ist das Journal die Quelle der Kennzahlen (vat-figures.ts, journalAlsQuelle); Journal und
  // Nebenbücher müssen übereinstimmen (#693, Akzeptanzkriterium „Voranmeldung aus Nebenbüchern und aus dem Journal“)
  it("Journal als Quelle: Kz 66 im Monat der Zahlung, gleich der Gegenprobe aus den Nebenbüchern", async () => {
    await firma({ journalAb: 2026 });
    const id = await beleg({ datum: "2026-11-20", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    await zahlung(id, -3_856, "2026-12-05");

    const november = await figures.computeVatFigures({ year: 2026, month: 11 });
    const dezember = await figures.computeVatFigures({ year: 2026, month: 12 });
    expect({ nov: november.kz66, dez: dezember.kz66 }).toEqual({ nov: 0, dez: 616 });
    expect({ nov: november.nebenbuecher?.kz66, dez: dezember.nebenbuecher?.kz66 }).toEqual({ nov: 0, dez: 616 });
  });
});
