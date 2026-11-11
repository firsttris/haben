import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Ein ausgeschlossenes Konto (#462) wird auch nicht mehr Auftraggeber- oder Gläubigerkonto einer SEPA-Datei: Die Oberfläche
 * bietet es nicht mehr an, der Server lehnt es trotzdem ab, etwa bei einem offenen Tab. Befund aus dem TDD-Review von #576.
 */

const IBAN = "DE89370400440532013000";

describe.skipIf(!testDatabaseUrl)("Ausgeschlossenes Konto in SEPA-Dateien (Postgres, #462)", () => {
  let bank: typeof import("./index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const now = new Date("2026-09-16T08:00:00Z");

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate sepa_direct_debit_items, sepa_direct_debits, sepa_transfer_items, sepa_transfers, write_offs, allocations, bank_transactions,
      bank_imports, bank_accounts, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, iban, bic, versteuerung, kontenrahmen, glaeubiger_id)
      values (1, 'Müller & Söhne Design', 'Musterstraße 1', '93047', 'Regensburg', 'a@example.com', '198/113/10010', 'BY',
              ${IBAN}, 'COBADEFFXXX', 'ist', 'SKR03', 'DE98ZZZ09999999999')`;
  });

  async function ausgeschlossenesKonto() {
    const account = await bank.createAccount(actor, { name: "Fremdkonto", iban: IBAN, purpose: "geschaeft" });
    await bank.excludeAccount(actor, account.id);
    return account.id;
  }

  const meldung = (work: Promise<unknown>) =>
    work.then(
      () => "angelegt",
      (e: Error) => e.message,
    );

  it("createSepaTransfer lehnt ein ausgeschlossenes Konto als Auftraggeberkonto ab", async () => {
    const bankAccountId = await ausgeschlossenesKonto();
    const result = await meldung(bank.createSepaTransfer(actor, { bankAccountId, executionDate: "2026-09-17", items: [] }, now));
    expect(result).toMatch(/ausgeschlossen/);
    expect(await sql`select 1 from sepa_transfers`).toHaveLength(0);
  });

  it("createDirectDebitFile lehnt ein ausgeschlossenes Konto als Gläubigerkonto ab", async () => {
    const bankAccountId = await ausgeschlossenesKonto();
    const result = await meldung(bank.createDirectDebitFile(actor, { bankAccountId, invoiceIds: [] }, now));
    expect(result).toMatch(/ausgeschlossen/);
    expect(await sql`select 1 from sepa_direct_debits`).toHaveLength(0);
  });
});
