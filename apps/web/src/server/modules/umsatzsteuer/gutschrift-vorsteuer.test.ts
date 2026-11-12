import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const eingang = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Musterlieferant GmbH",
  "Testfirma",
  purpose,
  "Eingang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

describe.skipIf(!testDatabaseUrl)("Vorsteuer aus Gutschriften erst mit der Erstattung (Postgres)", () => {
  let figures: typeof import("./vat-figures.ts");
  let bank: typeof import("../bank/index.ts");
  let documents: typeof import("../belege/documents.ts");
  let verrechnung: typeof import("../bank/verrechnung.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const februar = { year: 2026, month: 2 };
  const maerz = { year: 2026, month: 3 };
  let lauf = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("./vat-figures.ts");
    bank = await import("../bank/index.ts");
    documents = await import("../belege/documents.ts");
    verrechnung = await import("../bank/verrechnung.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate document_settlements, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    // Nebenbücher statt Journal: Das Journal bucht eine Verrechnung nicht (#274), die Voranmeldung rechnet sie deshalb
    // vor dem Stichjahr aus den Nebenbüchern (docs/adr/journal-als-quelle.md).
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03', 2027)`;
  });

  type BelegBetrag = { taxRate: 1900 | 700; net: number; tax: number; originalNet?: number; originalTax?: number };

  /** Bucht einen Beleg; negative Beträge sind eine Gutschrift */
  async function beleg(date: string, amounts: BelegBetrag[], extra: { payment?: "bank" | "kasse"; currency?: string; exchangeRate?: string } = {}) {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ++lauf, 16, 74, 70]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Musterlieferant GmbH",
      supplierUstId: "",
      invoiceNumber: `GUT-${lauf}`,
      documentDate: date,
      dueDate: null,
      category: "telefon",
      payment: extra.payment ?? "bank",
      note: "",
      ...(extra.currency ? { currency: extra.currency, exchangeRate: extra.exchangeRate } : {}),
      amounts,
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Bankumsatz und Zuordnung auf einen Beleg; der Betrag trägt das Vorzeichen des Umsatzes */
  async function zahle(date: string, purpose: string, amount: number, documentId: string) {
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([eingang(date, purpose, (amount / 100).toFixed(2).replace(".", ","))]), filename: `${purpose}.csv` },
      null,
    );
    const [tx] = await sql`select id from bank_transactions where purpose = ${purpose}`;
    await bank.allocate(actor, { kind: "document", transactionId: tx!.id as string, documentId, amount });
  }

  it("Gutschrift im Februar, Erstattung im März: Februar ohne, März mit der Vorsteuer", async () => {
    await beleg("2026-02-10", [{ taxRate: 1900, net: 100_000, tax: 19_000 }]);
    // Jahresabrechnung des Versorgers: 439,56 € brutto, davon 70,18 € Vorsteuer
    const gutschrift = await beleg("2026-02-16", [{ taxRate: 1900, net: -36_938, tax: -7_018 }]);

    const vorher = await figures.computeVatFigures(februar);
    expect(vorher.kz66).toBe(19_000);
    expect(vorher.inputTax.map((r) => r.documentId)).not.toContain(gutschrift);

    await zahle("15.03.26", "Erstattung Stadtwerke", 43_956, gutschrift);
    const nachher = await figures.computeVatFigures(maerz);
    expect(nachher.kz66).toBe(-7_018);
    expect(nachher.inputTax.map(({ number: _nummer, ...rest }) => rest)).toEqual([
      { documentId: gutschrift, date: "2026-03-15", supplier: "Musterlieferant GmbH", rate: 1900, base: -36_938, tax: -7_018 },
    ]);
    // Über das Jahr bleibt die Vorsteuer dieselbe, nur die Verteilung ändert sich
    expect((await figures.computeVatFigures(februar)).kz66 + nachher.kz66).toBe(19_000 - 7_018);
  }, 60_000);

  it("Verrechnung mit einer Rechnung: die Vorsteuer mindert sich im Monat der Aufrechnung", async () => {
    await beleg("2026-02-10", [{ taxRate: 1900, net: 10_000, tax: 1_900 }]);
    const gutschrift = await beleg("2026-02-16", [{ taxRate: 1900, net: -3_000, tax: -570 }]);
    const rechnung = await beleg("2026-02-20", [{ taxRate: 1900, net: 5_000, tax: 950 }]);
    await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 3_570,
      date: "2026-04-20",
      note: "Gutschrift verrechnet",
    });

    expect((await figures.computeVatFigures(februar)).kz66).toBe(1_900 + 950);
    expect((await figures.computeVatFigures(maerz)).kz66).toBe(0);
    const april = await figures.computeVatFigures({ year: 2026, month: 4 });
    expect(april.kz66).toBe(-570);
    expect(april.inputTax.map(({ number: _nummer, ...rest }) => rest)).toEqual([
      { documentId: gutschrift, date: "2026-04-20", supplier: "Musterlieferant GmbH", rate: 1900, base: -3_000, tax: -570 },
    ]);
  }, 60_000);

  it("Teilerstattung und Ausbuchung: je Vorgang anteilig nach Steuersatz", async () => {
    // Gutschrift über 1.297,00 € brutto: 1.000,00 € zu 19 % und 100,00 € zu 7 %
    const gutschrift = await beleg("2026-02-16", [
      { taxRate: 1900, net: -100_000, tax: -19_000 },
      { taxRate: 700, net: -10_000, tax: -700 },
    ]);
    await zahle("15.03.26", "Teilerstattung", 64_850, gutschrift);
    const maerz66 = (await figures.computeVatFigures(maerz)).kz66;
    expect(maerz66).toBe(-9_850);

    // Den Rest bucht die Ausbuchung im April aus (§ 17 Abs. 1 UStG), die Vorsteuer folgt dort
    await bank.writeOff(actor, { kind: "skontoErhalten", documentId: gutschrift, date: "2026-04-30" });
    const april = await figures.computeVatFigures({ year: 2026, month: 4 });
    expect(april.kz66).toBe(-9_850);
    expect(april.inputTax.map((r) => [r.rate, r.base, r.tax])).toEqual([
      [1900, -50_000, -9_500],
      [700, -5_000, -350],
    ]);
    expect(maerz66 + april.kz66).toBe(-19_700);
  }, 60_000);

  it("Bar bezahlte Gutschrift: das Geld ist mit der Buchung zurück, die Vorsteuer zählt im Belegmonat", async () => {
    // Kasse statt Bank: bar bezahlt gibt es keinen offenen Posten, den eine spätere Erstattung ausgleichen könnte
    const gutschrift = await beleg("2026-02-16", [{ taxRate: 1900, net: -36_938, tax: -7_018 }], { payment: "kasse" });

    const februar66 = await figures.computeVatFigures(februar);
    expect(februar66.kz66).toBe(-7_018);
    expect(februar66.inputTax.map(({ number: _nummer, ...rest }) => rest)).toEqual([
      { documentId: gutschrift, date: "2026-02-16", supplier: "Musterlieferant GmbH", rate: 1900, base: -36_938, tax: -7_018 },
    ]);
  }, 60_000);

  it("Kursdifferenz auf eine Gutschrift in Fremdwährung: der Rest gleicht aus, die Vorsteuer ist vollständig", async () => {
    // 100,00 USD + 19,00 USD zu 1,0812: 92,49 € + 17,57 € = 110,06 € brutto
    const gutschrift = await beleg("2026-02-16", [{ taxRate: 1900, net: 0, tax: 0, originalNet: -10_000, originalTax: -1_900 }], {
      currency: "USD",
      exchangeRate: "1,0812",
    });
    await bank.importStatement(actor, { bytes: dkbCsv([eingang("15.03.26", "Erstattung Acme", "100,00")]), filename: "kurs.csv" }, null);
    const [tx] = await sql`select id from bank_transactions where purpose = ${"Erstattung Acme"}`;
    // 100,00 € erstattet, 10,06 € Kursdifferenz: der offene Posten ist damit ganz ausgeglichen
    await bank.allocateWithRest(actor, {
      transactionId: tx!.id as string,
      target: { kind: "document", documentId: gutschrift },
      rest: "kursdifferenz",
    });

    expect((await figures.computeVatFigures(februar)).kz66).toBe(0);
    const imMaerz = await figures.computeVatFigures(maerz);
    expect(imMaerz.kz66).toBe(-1_757);
    expect(imMaerz.inputTax.reduce((summe, zeile) => summe + zeile.tax, 0)).toBe(-1_757);
  }, 60_000);

  it("Grenze: ab dem Stichjahr kommt Kz 66 aus dem Journal und kennt den Versatz nicht (#778)", async () => {
    // Stichjahr auf das Buchungsjahr ziehen: die Voranmeldung rechnet dann aus dem Journal statt aus den Nebenbüchern
    await sql`update company set journal_ab = 2026`;
    const gutschrift = await beleg("2026-02-16", [{ taxRate: 1900, net: -36_938, tax: -7_018 }]);
    await zahle("15.03.26", "Erstattung Stadtwerke", 43_956, gutschrift);

    // Bekannte Grenze: das Journal bucht die Vorsteuer der Gutschrift am Belegdatum und kennt den Ausgleich nicht.
    // Deshalb steht sie hier im Februar statt im März — die Verteilung aus #777 greift nur vor dem Stichjahr.
    // Wird die Journal-Seite aus #778 gebaut, muss dieser Test rot werden und die Erwartung wandern.
    expect((await figures.computeVatFigures(februar)).kz66).toBe(-7_018);
    expect((await figures.computeVatFigures(maerz)).kz66).toBe(0);
  }, 60_000);

  it("Aus einem Umzug übernommener Beleg: die Steuer ist anderswo angemeldet, Haben mindert nichts", async () => {
    // Beleg aus dem Vorgängerprogramm: dort schon angemeldet, Haben darf ihn nicht noch einmal mindern.
    // Die Kennung setzt der Umzug vor dem Buchen; danach sperrt der GoBD-Trigger die Zeile.
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ++lauf, 16, 74, 70]);
    const { id: umzug } = await documents.uploadDocument(actor, { bytes, filename: `umzug-${lauf}.jpg` });
    await documents.updateDocument(actor, umzug, {
      supplierName: "Musterlieferant GmbH",
      supplierUstId: "",
      invoiceNumber: `GUT-${lauf}`,
      documentDate: "2026-02-16",
      dueDate: null,
      category: "telefon",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: -36_938, tax: -7_018 }],
    });
    // Der Umzug legt Import und Voucher an; documents.lexoffice_voucher_id zeigt per Fremdschlüssel darauf.
    await sql`insert into lexoffice_imports (id, progress) values (${"22222222-2222-4222-8222-222222222222"}, ${"{}"}::jsonb)
      on conflict (id) do nothing`;
    await sql`insert into lexoffice_vouchers (id, lexoffice_id, import_id, type, direction, date, status, net, tax, gross, taxes, categories, raw)
      values (${"11111111-1111-4111-8111-111111111111"}, ${"umzug-2026-001"}, ${"22222222-2222-4222-8222-222222222222"},
              ${"invoice"}, ${"expense"}, ${"2026-02-16"}, ${"open"}, ${-36_938}, ${-7_018}, ${-43_956},
              ${"[]"}::jsonb, ${"[]"}::jsonb, ${"{}"}::jsonb)
      on conflict (id) do nothing`;
    await sql`update documents set lexoffice_voucher_id = ${"11111111-1111-4111-8111-111111111111"} where id = ${umzug}`;
    await documents.bookDocument(actor, umzug);
    await zahle("15.03.26", "Erstattung Umzug", 43_956, umzug);

    // Ohne die Zeile isNull(lexofficeVoucherId) in gutschrift.ts stünde hier -7_018 für eine Steuer,
    // die in Haben nie angemeldet wurde.
    expect((await figures.computeVatFigures(maerz)).kz66).toBe(0);
  }, 60_000);

  it("Drei Raten auf eine Gutschrift: die Anteile ergeben zusammen genau die Vorsteuer", async () => {
    // 119,00 € brutto, 19,00 € Vorsteuer, in drei Raten zu 39,67 / 39,67 / 39,66 €.
    // Einzeln gerundet wären es 6,33 + 6,33 + 6,33 = 18,99 €; die Fortschreibung muss auf 19,00 € kommen.
    const gutschrift = await beleg("2026-02-16", [{ taxRate: 1900, net: -10_000, tax: -1_900 }]);
    await zahle("15.03.26", "Rate 1", 3_967, gutschrift);
    await zahle("15.04.26", "Rate 2", 3_967, gutschrift);
    await zahle("15.05.26", "Rate 3", 3_966, gutschrift);

    const summe =
      (await figures.computeVatFigures(maerz)).kz66 +
      (await figures.computeVatFigures({ year: 2026, month: 4 })).kz66 +
      (await figures.computeVatFigures({ year: 2026, month: 5 })).kz66;
    expect(summe).toBe(-1_900);
    // Keine Rate ohne Wirkung, keine doppelt
    for (const monat of [3, 4, 5]) expect((await figures.computeVatFigures({ year: 2026, month: monat })).kz66).not.toBe(0);
  }, 60_000);

  it("SKR04 mit Soll-Versteuerung: dieselbe Verteilung wie SKR03 mit Ist", async () => {
    // Wechsel vor der ersten Buchung des Jahres, sonst sperrt company_settings_lock die Umstellung
    await sql`update company set kontenrahmen = 'SKR04', versteuerung = 'soll'`;
    const gutschrift = await beleg("2026-02-16", [{ taxRate: 1900, net: -36_938, tax: -7_018 }]);
    await zahle("15.03.26", "Erstattung Stadtwerke", 43_956, gutschrift);

    // Die Vorsteuer einer Gutschrift hängt am Ausgleich, nicht an der Versteuerungsart: die betrifft nur eigene Umsätze
    expect((await figures.computeVatFigures(februar)).kz66).toBe(0);
    expect((await figures.computeVatFigures(maerz)).kz66).toBe(-7_018);
  }, 60_000);
});
