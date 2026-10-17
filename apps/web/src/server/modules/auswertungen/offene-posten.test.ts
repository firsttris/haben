import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n") + "\n");
}
const row = (date: string, purpose: string, amount: string) => [date, date, "Gebucht", "Nordwerk", "Testfirma", purpose, amount.startsWith("-") ? "Ausgang" : "Eingang", "DE02100100100006820101", amount, "", "", ""];

/**
 * „Offen“ ist eine Regel (@haben/core, lebenszyklus.ts), genutzt von Rechnungsliste, Bankabgleich, offenen Posten,
 * Mahnwesen und der Sperre der Firmendaten. Dieser Test lässt alle Fälle durch alle Stellen laufen.
 */
describe.skipIf(!testDatabaseUrl)("offener Betrag überall gleich (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let bank: typeof import("../bank/bank.ts");
  let reports: typeof import("./reports.ts");
  let guard: typeof import("../stammdaten/settings-guard.ts");
  let dunning: typeof import("../rechnungen/dunning.ts");
  const actor = "test-user";
  const today = "2026-06-30";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    bank = await import("../bank/bank.ts");
    reports = await import("./reports.ts");
    guard = await import("../stammdaten/settings-guard.ts");
    dunning = await import("../rechnungen/dunning.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "10001", name: "Nordwerk Software GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
        email: "", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
      })
    ).id;
  });

  async function invoice(net: number, issueDate = "2026-05-02") {
    const draft = await invoices.createDraft(actor, {
      contactId, issueDate, serviceFrom: null, serviceTo: null, paymentTermDays: 14, format: "zugferd", note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std." as const, unitPrice: net, taxRate: 1900 as const }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function pay(invoiceId: string, amount: number, date: string) {
    const label = `Zahlung ${invoiceId.slice(0, 8)} ${amount}`;
    const euros = (Math.abs(amount) / 100).toFixed(2).replace(".", ",");
    await bank.importStatement(actor, { bytes: dkbCsv([row(date, label, `${amount < 0 ? "-" : ""}${euros}`)]), filename: `${label}.csv` }, null);
    const [tx] = await sql`select id from bank_transactions where purpose = ${label}`;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId, amount });
  }

  it("Rechnungsliste, Bankabgleich, offene Posten, Mahnwesen und Sperre der Firmendaten zählen dasselbe", async () => {
    const unbezahlt = await invoice(100_00); // 119 €
    const teilweise = await invoice(200_00); // 238 €
    await pay(teilweise.id, 100_00, "01.06.26");
    const bezahlt = await invoice(50_00); // 59,50 €
    await pay(bezahlt.id, 59_50, "02.06.26");
    // Bezahlt, dann storniert: die Erstattung ist offen (über die Stornorechnung)
    const erstatten = await invoice(10_00); // 11,90 €
    await pay(erstatten.id, 11_90, "03.06.26");
    const stornoErstatten = await invoices.cancelInvoice(actor, erstatten.id, "2026-06-10");
    // Unbezahlt storniert: nichts offen, auch nicht -0
    const storniert = await invoice(30_00);
    const stornoLeer = await invoices.cancelInvoice(actor, storniert.id, "2026-06-11");
    // Korrektur: Gutschrift offen
    const korrigiert = await invoice(80_00);
    const korrektur = await invoices.finalizeInvoice(actor, (await invoices.createCorrection(actor, korrigiert.id, "2026-06-12")).id);

    // 1. Rechnungsliste
    const list = await invoices.listInvoices(today);
    const open = Object.fromEntries(list.map((i) => [i.number, i.open]));
    expect(open).toEqual({
      [unbezahlt.number!]: 119_00,
      [teilweise.number!]: 138_00,
      [bezahlt.number!]: 0,
      [erstatten.number!]: 0,
      [stornoErstatten.number!]: -11_90,
      [storniert.number!]: 0,
      [stornoLeer.number!]: 0,
      [korrigiert.number!]: 95_20,
      [korrektur.number!]: -95_20,
    });
    expect(Object.is(list.find((i) => i.id === stornoLeer.id)!.open, -0)).toBe(false);
    const expected = new Map(list.filter((i) => i.status === "final" && i.open !== 0).map((i) => [i.id, i.open]));
    expect(expected.size).toBe(5);

    // 2. Bankabgleich: offene Rechnungen zum Zuordnen
    const items = (await bank.openItems()).filter((i) => i.type === "invoice");
    expect(new Map(items.map((i) => [i.id, i.open]))).toEqual(expected);

    // 3. Offene Posten: auch die Erstattung aus dem Storno (vorher fehlte sie hier)
    const { receivables, receivablesTotal } = await reports.openPositions(today);
    expect(new Map(receivables.map((i) => [i.id, i.open]))).toEqual(expected);
    expect(receivablesTotal).toBe([...expected.values()].reduce((s, v) => s + v, 0));

    // 4. Sperre der Firmendaten: so viele offene Rechnungen wie in der Liste
    expect((await guard.settingsLocks("2027-01-04")).versteuerung).toContain(`${expected.size} Rechnungen sind noch offen`);

    // 5. Mahnwesen: nur Rechnungen mit offenem Betrag zugunsten der Firma
    const dunnable = (await dunning.overdueInvoices("2026-07-30")).map((i) => i.id).sort();
    expect(dunnable).toEqual([unbezahlt.id, teilweise.id, korrigiert.id].sort());
  }, 120_000);

  it("offene Posten: die Erstattung aus einem Storno steht auch dann drin, wenn sonst nichts offen ist", async () => {
    const paid = await invoice(10_00);
    await pay(paid.id, 11_90, "03.06.26");
    const storno = await invoices.cancelInvoice(actor, paid.id, "2026-06-10");
    const { receivables } = await reports.openPositions(today);
    expect(receivables).toEqual([expect.objectContaining({ id: storno.id, open: -11_90, number: storno.number })]);
    // Ausgezahlt: weg
    await pay(storno.id, -11_90, "15.06.26");
    expect((await reports.openPositions(today)).receivables).toEqual([]);
  }, 60_000);
});
