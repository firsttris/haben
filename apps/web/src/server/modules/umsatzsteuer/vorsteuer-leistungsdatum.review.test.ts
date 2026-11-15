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

  /**
   * Firma vor dem Stichjahr: Die Kennzahlen kommen aus den Nebenbüchern, dort entscheidet die Zuordnung. Im Zeitraum ab
   * dem Stichjahr rechnet Haben aus dem Journal; das folgt mit der Buchungsseite (Zwischenkonto, #693).
   */
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

  /** Kz 66 aus dem Journal und aus den Nebenbüchern je Monat */
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

  // Bar oder privat bezahlt ist der Beleg mit der Buchung ausgeglichen (docs/umsatzsteuer.md, Vorsteuer Kz 66; belegbuchung.ts
  // parkt deshalb nichts): gezahlt vor der Ausführung, also abziehbar im Monat der Zahlung (UStAE 15.3 Abs. 1 Satz 2).
  // Journal und Nebenbücher müssen denselben Monat nennen
  it("Journal als Quelle: privat bezahlt vor der Ausführung, Journal und Nebenbücher im selben Monat", async () => {
    await firma({ journalAb: 2026, kontenrahmen: "SKR04", versteuerung: "soll" });
    await beleg({ datum: "2026-11-20", von: "2026-12-01", bis: "2026-12-31", payment: "privat", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });

    const monate = [
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
    ];
    expect(await beideQuellen(monate)).toEqual({ journal: [616, 0], nebenbuecher: [616, 0] });
  });

  // Storno am 20.12., der November ist noch nicht gemeldet (Dauerfristverlängerung, § 46 UStDV): Die Gegenbuchung kommt
  // auf das Belegdatum (cancellationDate). Die mit aufgehobene Zahlung vom 5.12. nimmt ihre Umbuchung vom Zwischenkonto
  // zurück; im November stand aber noch keine Vorsteuer. Kz 66 darf dort nicht negativ werden (§ 17 Abs. 1 UStG:
  // Berichtigung im Zeitraum der Änderung), Journal und Nebenbücher müssen übereinstimmen
  it("Journal als Quelle: Storno eines geparkten, bezahlten Belegs mindert keinen Monat vor der Zahlung", async () => {
    await firma({ journalAb: 2026 });
    const id = await beleg({ datum: "2026-11-20", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    const zuordnung = await zahlung(id, -3_856, "2026-12-05");
    await cancellation.cancelDocument(actor, id, { reason: "falscher Beleg", allocationIds: [zuordnung] }, "2026-12-20");

    const monate = [
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
    ];
    const [zwischenkonto] = await sql`select coalesce(sum(debit - credit), 0)::int as saldo from journal_lines where account = '1548'`;
    expect({ ...(await beideQuellen(monate)), zwischenkonto: zwischenkonto!.saldo }).toEqual({ journal: [0, 0], nebenbuecher: [0, 0], zwischenkonto: 0 });
  });

  // Nach der Ausführung bezahlt (Zahlungsziel): § 15 Abs. 1 Satz 1 Nr. 1 UStG ist mit Leistung und Rechnung erfüllt, die
  // Vorsteuer gehört in den Monat der Ausführung. Das Journal bucht sie bisher mit der Zahlung — im Januar. Beide Quellen
  // müssen denselben Monat nennen (#693).
  it("Journal als Quelle: nach der Ausführung bezahlt, Kz 66 im Monat der Ausführung", async () => {
    await firma({ journalAb: 2026 });
    const id = await beleg({ datum: "2026-11-20", von: "2026-11-15", bis: "2026-12-14", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    await zahlung(id, -3_856, "2027-01-10");

    const monate = [
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ];
    expect(await beideQuellen(monate)).toEqual({ journal: [0, 616, 0], nebenbuecher: [0, 616, 0] });
  });

  // Nie bezahlt: Die Vorsteuer steht trotzdem im Monat der Ausführung, die Verbindlichkeit bleibt offen. Sonst hinge der
  // Abzug an einem Zahlungsziel, das der Unternehmer nicht steuert.
  it("Journal als Quelle: nie bezahlt, Kz 66 im Monat der Ausführung", async () => {
    await firma({ journalAb: 2026 });
    await beleg({ datum: "2026-11-20", von: "2026-11-15", bis: "2026-12-14", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });

    const monate = [
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ];
    expect(await beideQuellen(monate)).toEqual({ journal: [0, 616, 0], nebenbuecher: [0, 616, 0] });
  });

  // Storno vor der Ausführung: Die Freigabe wird in ihrem eigenen Monat aufgehoben, damit dort keine Minderung ohne
  // Gegenstück steht (§ 17 Abs. 1 UStG: Berichtigung im Zeitraum der Änderung).
  it("Journal als Quelle: Storno vor der Ausführung hebt die Freigabe wieder auf", async () => {
    await firma({ journalAb: 2026 });
    const id = await beleg({ datum: "2026-11-20", von: "2026-11-15", bis: "2026-12-14", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    await cancellation.cancelDocument(actor, id, { reason: "falscher Beleg" }, "2026-11-25");

    const monate = [
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
    ];
    const [zwischenkonto] = await sql`select coalesce(sum(debit - credit), 0)::int as saldo from journal_lines where account = '1548'`;
    expect({ ...(await beideQuellen(monate)), zwischenkonto: zwischenkonto!.saldo }).toEqual({ journal: [0, 0], nebenbuecher: [0, 0], zwischenkonto: 0 });
  });
  // Teilzahlung nach der Ausführung: Die ganze Vorsteuer ist seit Dezember abziehbar (§ 15 Abs. 1 Satz 1 Nr. 1 UStG), eine
  // Teilzahlung im Januar ändert daran nichts und darf keinen Teil auf das Zwischenkonto zurückholen
  it("Journal als Quelle: Teilzahlung nach der Ausführung mindert Kz 66 nicht", async () => {
    await firma({ journalAb: 2026, kontenrahmen: "SKR04", versteuerung: "soll" });
    const id = await beleg({ datum: "2026-11-20", von: "2026-11-15", bis: "2026-12-14", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    await zahlung(id, -1_000, "2027-01-10");

    const monate = [
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ];
    const [zwischenkonto] = await sql`select coalesce(sum(debit - credit), 0)::int as saldo from journal_lines where account = '1434'`;
    expect({ ...(await beideQuellen(monate)), zwischenkonto: zwischenkonto!.saldo }).toEqual({
      journal: [0, 616, 0],
      nebenbuecher: [0, 616, 0],
      zwischenkonto: 0,
    });
  });

  // Abgeschlossenes Jahr der Ausführung: Die Buchung des Belegs bleibt möglich und die Freigabe entfällt; die Vorsteuer
  // kommt dann mit der Zahlung (der Weg vor #693). Vorher fing ein `catch {}` dafür jeden Fehler ab, auch einen echten
  // wie den Wechsel des Kontenrahmens.
  it("abgeschlossenes Jahr der Ausführung: Buchung bleibt möglich, Freigabe entfällt", async () => {
    await firma({ journalAb: 2026 });
    await sql`insert into year_closings (year) values (2026)`;
    const id = await beleg({
      datum: "2025-11-20",
      von: "2025-12-01",
      bis: "2026-01-31",
      amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }],
    });

    expect((await monat(12, 2025)).kz66).toBe(0);
    expect((await monat(1, 2026)).kz66).toBe(0);

    await zahlung(id, -3_856, "2027-02-10");

    expect((await monat(1, 2026)).kz66).toBe(0);
    expect((await monat(2, 2027)).kz66).toBe(616);
  });
  /** Saldo des Zwischenkontos (SKR03 1548, SKR04 1434) über alle Buchungen */
  async function zwischenkontoSaldo() {
    const [z] = await sql`select coalesce(sum(debit - credit), 0)::int as saldo from journal_lines where account in ('1548', '1434')`;
    return z!.saldo as number;
  }

  // Zahlung vor der Ausführung mit Rechnung: abziehbar im Monat der Zahlung (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 3 UStG,
  // Abschnitt 15.3 UStAE). Ab dem Stichjahr ist das Journal die Quelle von Kz 66; es muss denselben Monat nennen wie die
  // Gegenprobe, und die Freigabe zur Ausführung darf nicht zusätzlich wirken (#930)
  it("Journal als Quelle: Zahlung vor der Ausführung, Kz 66 im Zahlungsmonat, SKR03/Ist", async () => {
    await firma({ journalAb: 2026 });
    const id = await beleg({ datum: "2026-11-20", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    await zahlung(id, -3_856, "2026-11-25");

    const monate = [
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
    ];
    expect({ ...(await beideQuellen(monate)), zwischenkonto: await zwischenkontoSaldo() }).toEqual({
      journal: [616, 0],
      nebenbuecher: [616, 0],
      zwischenkonto: 0,
    });
  });

  it("Journal als Quelle: Zahlung vor der Ausführung, Kz 66 im Zahlungsmonat, SKR04/Soll", async () => {
    await firma({ journalAb: 2026, kontenrahmen: "SKR04", versteuerung: "soll" });
    const id = await beleg({ datum: "2026-10-20", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    await zahlung(id, -3_856, "2026-11-03");

    const monate = [
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
    ];
    expect({ ...(await beideQuellen(monate)), zwischenkonto: await zwischenkontoSaldo() }).toEqual({
      journal: [0, 616, 0],
      nebenbuecher: [0, 616, 0],
      zwischenkonto: 0,
    });
  });

  // Zwei Teilzahlungen vor der Ausführung (je ein Drittel, krumme Cent): jede zieht ihren Anteil im Monat der Zahlung, der
  // Rest kommt mit der Ausführung; zusammen genau die Vorsteuer des Belegs
  it("Journal als Quelle: zwei Teilzahlungen vor der Ausführung, Rest mit der Ausführung", async () => {
    await firma({ journalAb: 2026 });
    const id = await beleg({ datum: "2026-09-20", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 1_000, tax: 190 }] });
    await zahlung(id, -397, "2026-10-05");
    await zahlung(id, -397, "2026-11-05");

    const monate = [
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
    ];
    const ergebnis = await beideQuellen(monate);
    expect({ ...ergebnis, zwischenkonto: await zwischenkontoSaldo() }).toEqual({
      journal: ergebnis.nebenbuecher,
      nebenbuecher: [63, 64, 63],
      zwischenkonto: 0,
    });
  });

  // Aufgehobene Zuordnung einer Anzahlung: Rücknahme am Tag der Aufhebung (#782), mit der Ausführung kommt die Vorsteuer
  // wieder; Journal und Nebenbücher gleich, das Zwischenkonto am Ende leer
  it("Journal als Quelle: Anzahlung, Zuordnung aufgehoben, dann Ausführung", async () => {
    await firma({ journalAb: 2026 });
    const id = await beleg({ datum: "2026-08-20", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    const zuordnung = await zahlung(id, -3_856, "2026-09-05");
    await bank.reverseAllocation(actor, zuordnung, "2026-10-10");

    const monate = [
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
      { year: 2026, month: 12 },
    ];
    expect({ ...(await beideQuellen(monate)), zwischenkonto: await zwischenkontoSaldo() }).toEqual({
      journal: [616, -616, 616],
      nebenbuecher: [616, -616, 616],
      zwischenkonto: 0,
    });
  });

  // Storno eines vor der Ausführung bezahlten Belegs, der Oktober noch nicht gemeldet: Die Gegenbuchung kommt auf das
  // Belegdatum (cancellationDate), die Vorsteuer der Anzahlung hebt sich im Oktober auf; Journal wie Nebenbücher
  it("Journal als Quelle: Storno nach Anzahlung vor der Ausführung", async () => {
    await firma({ journalAb: 2026 });
    const id = await beleg({ datum: "2026-10-20", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    const zuordnung = await zahlung(id, -3_856, "2026-10-25");
    await cancellation.cancelDocument(actor, id, { reason: "falscher Beleg", allocationIds: [zuordnung] }, "2026-11-10");

    const monate = [
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
    ];
    expect({ ...(await beideQuellen(monate)), zwischenkonto: await zwischenkontoSaldo() }).toEqual({
      journal: [0, 0, 0],
      nebenbuecher: [0, 0, 0],
      zwischenkonto: 0,
    });
  });

  // Nach der Ausführung ist die Vorsteuer mit Leistung und Rechnung abziehbar (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 1 UStG); eine
  // Aufhebung der Anzahlung danach ändert daran nichts mehr (Vorgabe des Maintainers in #930) und schreibt vor allem den
  // Monat der Ausführung nicht rückwirkend um (#782: eine Aufhebung wirkt am Tag der Aufhebung)
  it("Journal als Quelle: Anzahlung vor der Ausführung, Aufhebung nach der Ausführung ändert nichts mehr", async () => {
    await firma({ journalAb: 2026 });
    const id = await beleg({ datum: "2026-08-20", von: "2026-09-01", bis: "2026-09-30", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    const zuordnung = await zahlung(id, -3_856, "2026-08-25");
    await bank.reverseAllocation(actor, zuordnung, "2026-10-10");

    const monate = [
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
    ];
    expect({ journal: (await beideQuellen(monate)).journal, zwischenkonto: await zwischenkontoSaldo() }).toEqual({
      journal: [616, 0, 0],
      zwischenkonto: 0,
    });
  });

  // Storno nach der Ausführung eines vor der Ausführung bezahlten Belegs: berichtigt im Monat des Stornos (§ 17 Abs. 1
  // UStG), der Monat der Ausführung bleibt, wie er war
  it("Journal als Quelle: Anzahlung vor der Ausführung, Storno nach der Ausführung berichtigt nur im Stornomonat", async () => {
    await firma({ journalAb: 2026, kontenrahmen: "SKR04", versteuerung: "soll" });
    const id = await beleg({ datum: "2026-08-20", von: "2026-09-01", bis: "2026-09-30", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    const zuordnung = await zahlung(id, -3_856, "2026-08-25");
    await cancellation.cancelDocument(actor, id, { reason: "falscher Beleg", allocationIds: [zuordnung] }, "2026-10-10");

    const monate = [
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
    ];
    const { journal } = await beideQuellen(monate);
    expect({ sep: journal[1], summe: journal.reduce((a, b) => a + b, 0), zwischenkonto: await zwischenkontoSaldo() }).toEqual({
      sep: 0,
      summe: 0,
      zwischenkonto: 0,
    });
  });

  // Skonto auf eine Zahlung vor der Ausführung: Der erlassene Rest mindert die Vorsteuer (§ 17 Abs. 1 Satz 2 UStG), die
  // Freigabe zur Ausführung darf seine Steuer nicht noch einmal ziehen; das Zwischenkonto endet bei null
  it("Journal als Quelle: Zahlung mit Skonto vor der Ausführung, keine Freigabe für den erlassenen Rest", async () => {
    await firma({ journalAb: 2026 });
    const id = await beleg({ datum: "2026-10-20", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    await zahlung(id, -3_779, "2026-11-05");
    await bank.writeOff(actor, { kind: "skontoErhalten", documentId: id, date: "2026-11-05" });

    const monate = [
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
    ];
    expect({ ...(await beideQuellen(monate)), zwischenkonto: await zwischenkontoSaldo() }).toEqual({
      journal: [604, 0],
      nebenbuecher: [604, 0],
      zwischenkonto: 0,
    });
  });

  // Verrechnung mit einer Gutschrift vor der Ausführung, vor der Ausführung wieder aufgehoben: Die Aufhebung legt den
  // Anteil zurück, die Freigabe zur Ausführung muss ihn wieder mitnehmen; das Zwischenkonto endet bei null
  it("Journal als Quelle: Verrechnung vor der Ausführung aufgehoben, Freigabe nimmt den Anteil wieder mit", async () => {
    await firma({ journalAb: 2026 });
    const rechnung = await beleg({ datum: "2026-09-20", von: "2026-12-01", bis: "2026-12-31", amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }] });
    const gutschrift = await beleg({ datum: "2026-10-01", erstattetBezahltes: false, amounts: [{ taxRate: 1900, net: -1_000, tax: -190 }] });
    const verrechnung = await import("../bank/verrechnung.ts");
    const { ids } = await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 1_190,
      date: "2026-10-05",
      note: "Gutschrift",
    });
    await verrechnung.reverseSettlement(actor, ids[0]!, "2026-10-20");

    const [rest] = await sql`select coalesce(sum(l.debit - l.credit), 0)::int as saldo from journal_lines l where l.account = '1548'`;
    const dezember = await figures.computeVatFigures({ year: 2026, month: 12 });
    expect({ zwischenkonto: rest!.saldo, dez: dezember.kz66 }).toEqual({ zwischenkonto: 0, dez: 616 });
  });
});
