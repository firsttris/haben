import type { OutgoingTaxDetails, PostingLine, TaxTreatment } from "@haben/core";
import type postgres from "postgres";
import { leeren } from "../server/test-db.ts";

// Ausschließlich synthetische Testdaten; kein Zahlungsschreiber der Anwendung.

export const taxDetails = (overrides: Partial<OutgoingTaxDetails> = {}): OutgoingTaxDetails => ({
  exemption: null,
  ancillary: null,
  foreignPlace: null,
  assetDisposal: false,
  ...overrides,
});

export async function turnoverFixtures(sql: postgres.Sql, mode: "ist" | "soll" = "ist", chart: "SKR03" | "SKR04" = "SKR03") {
  await leeren(sql)`truncate allocations, cash_entries, bank_transactions, bank_imports, bank_accounts, invoice_taxes,
    invoice_lines, invoices, legacy_voucher_payments, lexoffice_vouchers, lexoffice_imports,
    external_import_settlements, external_imports, journal_lines, journal_entries, asset_depreciations, assets, datev_bookings, archive_files,
    company cascade`;
  await sql`insert into company (id, name, versteuerung, kontenrahmen) values (1, 'Umsatztest', ${mode}, ${chart})`;
  const [account] = await sql`insert into bank_accounts (name, iban, purpose) values ('Privat bezeichnet', 'DE89370400440532013000', 'privat') returning id`;
  const [imported] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
    values (${account!.id}, 'test.csv', ${crypto.randomUUID()}, 'test', 1, 0) returning id`;
  let number = 0;
  const invoice = async (treatment: TaxTreatment = "regulaer", net = 10_000, tax = 1_900, details: OutgoingTaxDetails | null = null) => {
    const [row] = await sql`insert into invoices (issue_date, due_date, tax_treatment, net, tax, gross, tax_details)
      values ('2026-11-15', '2026-11-29', ${treatment}, ${net}, ${tax}, ${net + tax}, ${details ? JSON.stringify(details) : null}::jsonb) returning id`;
    await sql`insert into invoice_taxes (invoice_id, rate, base, tax) values (${row!.id}, ${tax ? 1900 : 0}, ${net}, ${tax})`;
    return row!.id as string;
  };
  const transaction = async (amount: number, date = "2026-11-05") => {
    const [row] = await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, dedup_hash)
      values (${account!.id}, ${imported!.id}, ${date}, ${amount}, ${crypto.randomUUID()}) returning id`;
    return row!.id as string;
  };
  const allocate = async (transactionId: string, invoiceId: string, amount: number, extra: Record<string, unknown> = {}) => {
    const [row] =
      await sql`insert into allocations ${sql({ transaction_id: transactionId, invoice_id: invoiceId, kind: "invoice", amount, ...extra })} returning id`;
    return row!.id as string;
  };
  const cash = async (amount: number, date: string, extra: Record<string, unknown> = {}) => {
    const [row] =
      await sql`insert into cash_entries ${sql({ number: ++number, date, amount, text: "Test", kind: "einnahme", tax_treatment: "kleinunternehmer", tax_rate: 0, ...extra })} returning id`;
    return row!.id as string;
  };
  const legacy = async (status: string, payment: unknown, extra: Record<string, unknown> = {}) => {
    const [run] = await sql`insert into lexoffice_imports (status, progress) values ('fertig', '{}') returning id`;
    const [row] =
      await sql`insert into lexoffice_vouchers ${sql({ lexoffice_id: crypto.randomUUID(), import_id: run!.id, source: "import", type: "invoice", direction: "einnahme", date: "2026-04-01", status, net: 10_000, tax: 1_900, gross: 11_900, taxes: JSON.stringify([{ rate: 1900, net: 10_000, tax: 1_900 }]), categories: "[]", payment: payment === null ? null : JSON.stringify(payment), raw: JSON.stringify({ taxType: "net" }), ...extra })} returning id`;
    return { id: row!.id as string, importId: run!.id as string };
  };
  const journal = async (
    sourceType: "allocation" | "invoice" | "manuell" | "import" | "eroeffnung",
    sourceId: string,
    lines: PostingLine[] = [
      { account: "1200", debit: 100, credit: 0, taxCode: null },
      { account: "8400", debit: 0, credit: 100, taxCode: null },
    ],
    date = "2026-11-05",
  ) => {
    const { withActor } = await import("../server/db/actor.ts");
    const { openBooks, post } = await import("../server/modules/buchhaltung/index.ts");
    return withActor("umsatztest", async (tx) => post(tx, await openBooks(tx), { date, description: "Umsatztest", sourceType, sourceId, lines }));
  };
  return { invoice, transaction, allocate, cash, legacy, journal, accountId: account!.id as string };
}
