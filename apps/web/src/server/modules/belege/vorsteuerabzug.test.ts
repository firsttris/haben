import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Vorsteuerabzug unabhängig vom Kleinunternehmer-Status (#852): Die Firmendaten tragen die Vorgabe „ohne
 * Vorsteuerabzug“ für steuerfreie Umsätze nach § 4 UStG (§ 15 Abs. 2 UStG), ein Entwurf kann sie am Beleg
 * überschreiben; beim Buchen hält der Beleg den angewandten Anteil fest. Erfundene Beträge: 100,00 € + 19 %.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const KONTEN = {
  SKR03: { software: "4964", vorsteuer: "1576", ustRc: "1787", verbindlichkeiten: "1600", edv: "0420", ustIge: "1774" },
  SKR04: { software: "6837", vorsteuer: "1406", ustRc: "3837", verbindlichkeiten: "3300", edv: "0650", ustIge: "3804" },
} as const;

describe.skipIf(!testDatabaseUrl)("Vorsteuerabzug unabhängig vom Kleinunternehmer (Postgres)", () => {
  let documents: typeof import("./documents.ts");
  let cancellation: typeof import("./cancellation.ts");
  let vat: typeof import("../umsatzsteuer/vat-figures.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let bank: typeof import("../bank/bank.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let fileSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    cancellation = await import("./cancellation.ts");
    vat = await import("../umsatzsteuer/vat-figures.ts");
    reports = await import("../auswertungen/reports.ts");
    invoices = await import("../rechnungen/invoices.ts");
    bank = await import("../bank/bank.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(
    kontenrahmen: "SKR03" | "SKR04",
    versteuerung: "ist" | "soll",
    firma: { kleinunternehmer?: boolean; ohneVorsteuerabzug?: boolean } = {},
  ) {
    await leeren(sql)`truncate document_cancellations, vat_returns, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, cash_entries,
      asset_depreciations, assets, journal_lines, journal_entries, document_splits, document_amounts, documents, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, versteuerung, kontenrahmen, kleinunternehmer, ohne_vorsteuerabzug)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${versteuerung}, ${kontenrahmen},
              ${firma.kleinunternehmer ?? false}, ${firma.ohneVorsteuerabzug ?? false})`;
  }

  type Options = {
    payment?: "bank" | "privat";
    amounts?: { taxRate: 1900 | 700 | 0; net: number; tax: number }[];
    category?: "software" | "anlage";
    reverseCharge?: "eu" | "drittland" | "ig_erwerb" | null;
    vorsteuerAnteil?: 0 | 10_000 | null;
    asset?: { name: string; kind: "edv"; method: "digital"; usefulLifeMonths: null } | null;
  };

  async function draft(options: Options = {}) {
    fileSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, Math.floor(fileSeq / 256), 13]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${fileSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Beispiel GmbH",
      supplierUstId: options.reverseCharge === "ig_erwerb" ? "ATU12345675" : "",
      invoiceNumber: `B-${fileSeq}`,
      documentDate: "2026-09-15",
      dueDate: null,
      category: options.category ?? "software",
      payment: options.payment ?? "bank",
      note: "",
      reverseCharge: options.reverseCharge ?? null,
      vorsteuerAnteil: options.vorsteuerAnteil ?? null,
      asset: options.asset ?? null,
      amounts: options.amounts ?? [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
    });
    return id;
  }

  async function entryLines(documentId: string) {
    return sql`select l.account, l.debit, l.credit, l.tax_code from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'document' and e.source_id = ${documentId} and e.reverses_id is null order by l.account, l.debit, l.credit`;
  }

  const byAccount = <T extends { account: string; debit: number; credit: number }>(lines: T[]) =>
    [...lines].sort((a, b) => a.account.localeCompare(b.account) || a.debit - b.debit || a.credit - b.credit);

  async function payFromBank(documentId: string, date: string, amount: string) {
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([[date, date, "Gebucht", "Testfirma", "Beispiel GmbH", "B", "Ausgang", "IE29AIBK93115212345678", amount, "", "", ""]]),
        filename: `konto-${fileSeq}.csv`,
      },
      null,
    );
    const [t] = await sql`select id, amount from bank_transactions order by booking_date desc limit 1`;
    await bank.allocate(actor, { kind: "document", transactionId: t!.id as string, documentId, amount: t!.amount as number });
  }

  const ausgabe = (euer: Awaited<ReturnType<typeof reports.euerForYear>>, key: string) => euer.ausgaben.find((l) => l.key === key)?.amount ?? 0;

  const anteilAmBeleg = async (id: string) => (await documents.getDocument(id))!.document.vorsteuerAnteil;

  it("SKR03, Ist: Firma ohne Vorsteuerabzug bucht brutto ohne Vorsteuer, Beleg hält Anteil 0 fest", async () => {
    const k = KONTEN.SKR03;
    await reset("SKR03", "ist", { ohneVorsteuerabzug: true });
    const id = await draft();
    await documents.bookDocument(actor, id);

    expect(await entryLines(id)).toEqual(
      byAccount([
        { account: k.software, debit: 11_900, credit: 0, tax_code: "keineVSt" },
        { account: k.verbindlichkeiten, debit: 0, credit: 11_900, tax_code: null },
      ]),
    );
    const beleg = (await documents.getDocument(id))!.document;
    expect(beleg).toMatchObject({ vorsteuerAnteil: 0, vorsteuerAbzug: false });
    expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(0);

    await payFromBank(id, "25.09.26", "-119,00");
    expect(ausgabe(await reports.euerForYear(2026), "ausgabe:software")).toBe(11_900);
  }, 30_000);

  it("SKR04, Soll: § 13b EU ohne Vorsteuerabzug — Steuer als Aufwand, Kz 46/47 ja, Kz 67 = 0", async () => {
    const k = KONTEN.SKR04;
    await reset("SKR04", "soll", { ohneVorsteuerabzug: true });
    const id = await draft({ reverseCharge: "eu" });
    await documents.bookDocument(actor, id);

    expect(await entryLines(id)).toEqual(
      byAccount([
        { account: k.software, debit: 10_000, credit: 0, tax_code: "RC13bEU" },
        { account: k.software, debit: 1_900, credit: 0, tax_code: "keineVSt" },
        { account: k.ustRc, debit: 0, credit: 1_900, tax_code: "RC13bEU" },
        { account: k.verbindlichkeiten, debit: 0, credit: 10_000, tax_code: null },
      ]),
    );
    const september = await vat.computeVatFigures({ year: 2026, month: 9 });
    expect([september.kz46, september.kz47, september.kz67]).toEqual([10_000, 1_900, 0]);
  }, 30_000);

  it("Anteil am Beleg schlägt die Firmenvorgabe in beide Richtungen; Neuerfassung übernimmt ihn", async () => {
    const k = KONTEN.SKR03;
    // Reguläre Firma, am Beleg ohne Abzug gewählt
    await reset("SKR03", "ist");
    const ohne = await draft({ vorsteuerAnteil: 0 });
    await documents.bookDocument(actor, ohne);
    expect(await entryLines(ohne)).toEqual(
      byAccount([
        { account: k.software, debit: 11_900, credit: 0, tax_code: "keineVSt" },
        { account: k.verbindlichkeiten, debit: 0, credit: 11_900, tax_code: null },
      ]),
    );
    // Storno und Neuerfassung: der Entwurf trägt die Entscheidung des gebuchten Belegs
    await cancellation.cancelDocument(actor, ohne, { reason: "Falsch erfasst" }, "2026-10-05");
    const reentry = await cancellation.reenterDocument(actor, ohne);
    expect(await anteilAmBeleg(reentry)).toBe(0);

    // Firma ohne Vorsteuerabzug, am Beleg voller Abzug gewählt
    await reset("SKR03", "ist", { ohneVorsteuerabzug: true });
    const voll = await draft({ vorsteuerAnteil: 10_000 });
    await documents.bookDocument(actor, voll);
    expect(await entryLines(voll)).toEqual(
      byAccount([
        { account: k.software, debit: 10_000, credit: 0, tax_code: "VSt19" },
        { account: k.vorsteuer, debit: 1_900, credit: 0, tax_code: "VSt19" },
        { account: k.verbindlichkeiten, debit: 0, credit: 11_900, tax_code: null },
      ]),
    );
    expect(await anteilAmBeleg(voll)).toBe(10_000);
    expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(1_900);
  }, 30_000);

  it("Kleinunternehmer zieht nie ab, auch gegen den Anteil am Beleg (§ 19 Abs. 1, § 15 Abs. 2 UStG)", async () => {
    const k = KONTEN.SKR03;
    await reset("SKR03", "ist");
    const id = await draft({ vorsteuerAnteil: 10_000 });
    await sql`update company set kleinunternehmer = true`;
    await documents.bookDocument(actor, id);

    expect(await entryLines(id)).toEqual(
      byAccount([
        { account: k.software, debit: 11_900, credit: 0, tax_code: "keineVSt" },
        { account: k.verbindlichkeiten, debit: 0, credit: 11_900, tax_code: null },
      ]),
    );
    expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(0);
  }, 30_000);

  it("innergemeinschaftlicher Erwerb mit nur steuerfreien Umsätzen ist gesperrt wie bei Kleinunternehmern", async () => {
    await reset("SKR03", "ist", { ohneVorsteuerabzug: true });
    const id = await draft({ reverseCharge: "ig_erwerb" });
    await expect(documents.bookDocument(actor, id)).rejects.toThrow(
      /Innergemeinschaftlicher Erwerb als Kleinunternehmer oder mit nur steuerfreien Umsätzen \(Erwerbsschwelle, § 1a Abs. 3 UStG\)/,
    );
    expect(await sql`select count(*)::int as n from journal_entries`).toEqual([{ n: 0 }]);
  }, 30_000);

  it("Anlage aus ig. Erwerb ohne Abzug am Beleg: Erwerbsteuer in den Anschaffungskosten (§ 9b EStG)", async () => {
    const k = KONTEN.SKR03;
    await reset("SKR03", "ist");
    const id = await draft({
      reverseCharge: "ig_erwerb",
      vorsteuerAnteil: 0,
      category: "anlage",
      asset: { name: "Maschine", kind: "edv", method: "digital", usefulLifeMonths: null },
      amounts: [{ taxRate: 1900, net: 100_000, tax: 19_000 }],
    });
    await documents.bookDocument(actor, id);

    // Netto und nicht abziehbare Erwerbsteuer stehen auf dem Anlagekonto (§ 9b Abs. 1 EStG)
    expect(await entryLines(id)).toEqual(
      byAccount([
        { account: k.edv, debit: 19_000, credit: 0, tax_code: "keineVSt" },
        { account: k.edv, debit: 100_000, credit: 0, tax_code: "IGE19" },
        { account: k.ustIge, debit: 0, credit: 19_000, tax_code: "IGE19" },
        { account: k.verbindlichkeiten, debit: 0, credit: 100_000, tax_code: null },
      ]),
    );
    // Die Anlage trägt dieselben Anschaffungskosten wie das Anlagekonto
    const [anlage] = await sql`select cost from assets where document_id = ${id}`;
    expect(anlage!.cost).toBe(119_000);
    const september = await vat.computeVatFigures({ year: 2026, month: 9 });
    expect([september.kz89, september.tax89, september.kz61]).toEqual([100_000, 19_000, 0]);
  }, 30_000);

  it("Rechnungen bleiben unberührt: „ohne Vorsteuerabzug“ ändert die Steuerbehandlung nicht", async () => {
    await reset("SKR03", "ist", { ohneVorsteuerabzug: true });
    expect((await invoices.newDraftDefaults("2026-10-01")).taxTreatment).toBe("regulaer");
  }, 30_000);
});
