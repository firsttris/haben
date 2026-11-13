import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Eine Umsatzsteuer-Erstattung des Finanzamts, die auf einem privaten Konto eingeht, tilgt die
 * Forderung gegen das Finanzamt (1780), darf aber nicht als Bankeingang des Betriebs gebucht
 * werden: Das Geld fließt ins Private, also Privatentnahme (SKR03 1800, SKR04 2100, in GmbH/UG
 * das Gesellschafter-Verrechnungskonto).
 *
 * Auf einem Geschäftskonto bleibt es bei 1200 gegen 1780.
 */
describe.skipIf(!testDatabaseUrl)("USt-Erstattung auf privatem Konto (Postgres)", () => {
  let bank: typeof import("./bank.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./bank.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate allocations, journal_lines, journal_entries, bank_transactions, bank_imports, bank_accounts, vat_returns, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', 'SKR03', 'ist')`;
  });

  async function konto(purpose: string, name: string, iban: string): Promise<string> {
    const [account] = await sql`
      insert into bank_accounts (name, iban, purpose) values (${name}, ${iban}, ${purpose}) returning id`;
    return (account as { id: string }).id;
  }

  /** Kontenrahmen, Rechtsform und Versteuerung des Betriebs; die Buchung muss in beiden Rahmen und in GmbH und UG stimmen */
  async function firma(kontenrahmen: "SKR03" | "SKR04", rechtsform: "einzelunternehmen" | "gmbh", versteuerung: "ist" | "soll" = "ist") {
    await sql`update company set kontenrahmen = ${kontenrahmen}, rechtsform = ${rechtsform}, versteuerung = ${versteuerung} where id = 1`;
  }

  async function umsatz(accountId: string, date: string, amount: number): Promise<string> {
    const [import_] = await sql`
      insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${accountId}, 'umsatz.csv', ${"a".repeat(64)}, 'swan', 1, 0) returning id`;
    const [transaction] = await sql`
      insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, dedup_hash)
      values (${accountId}, ${(import_ as { id: string }).id}, ${date}, ${amount}, 'FinMinSH,Landeskasse', ${`h${date}${amount}`})
      returning id`;
    return (transaction as { id: string }).id;
  }

  async function vermerk(kz83: number): Promise<string> {
    const [row] = await sql`
      insert into vat_returns (year, month, kz83, status, sent_at)
      values (2026, 43, ${kz83}, 'sent', now()) returning id`;
    return (row as { id: string }).id;
  }

  async function zeilen(transactionId: string) {
    const rows = await sql`
      select l.account, l.debit, l.credit from journal_lines l
      join journal_entries e on e.id = l.entry_id
      join allocations a on a.id = e.source_id
      where e.source_type = 'allocation' and a.transaction_id = ${transactionId} order by l.account`;
    return (rows as unknown as { account: string; debit: number; credit: number }[]).map((row) => ({
      account: row.account,
      debit: row.debit,
      credit: row.credit,
    }));
  }

  it("bucht die Erstattung auf dem Geschäftskonto gegen die Bank", async () => {
    const account = await konto("geschaeft", "Swan Geschäftskonto", "DE42100140009610447304");
    const transaction = await umsatz(account, "2026-10-15", 87_73);
    const returnId = await vermerk(-87_73);

    await bank.allocate(actor, { kind: "ustva", transactionId: transaction, vatReturnId: returnId, amount: 87_73 });

    expect(await zeilen(transaction)).toEqual([
      { account: "1200", debit: 87_73, credit: 0 },
      { account: "1780", debit: 0, credit: 87_73 },
    ]);
  });

  it("bucht die Erstattung auf dem privaten Konto als Entnahme, nicht gegen die Bank", async () => {
    const account = await konto("privat", "DKB Girokonto", "DE13120300000012099776");
    const transaction = await umsatz(account, "2026-10-15", 87_73);
    const returnId = await vermerk(-87_73);

    await bank.allocate(actor, { kind: "ustva", transactionId: transaction, vatReturnId: returnId, amount: 87_73 });

    expect(await zeilen(transaction)).toEqual([
      { account: "1780", debit: 0, credit: 87_73 },
      { account: "1800", debit: 87_73, credit: 0 },
    ]);
  });

  it("bucht eine Erstattung ohne Voranmeldungsbezug auf dem privaten Konto ebenfalls als Entnahme", async () => {
    const account = await konto("privat", "DKB Girokonto", "DE13120300000012099776");
    const transaction = await umsatz(account, "2026-10-12", 503_68);

    await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: transaction, amount: 503_68 });

    expect(await zeilen(transaction)).toEqual([
      { account: "1780", debit: 0, credit: 503_68 },
      { account: "1800", debit: 503_68, credit: 0 },
    ]);
  });

  it("bucht eine Erstattung Umsatzsteuer Vorjahr (Steuerzahlung mit Bezugsjahr) auf dem privaten Konto als Entnahme", async () => {
    const account = await konto("privat", "DKB Girokonto", "DE13120300000012099776");
    const transaction = await umsatz(account, "2026-10-12", 503_68);

    await bank.allocate(actor, {
      kind: "steuer",
      transactionId: transaction,
      amount: 503_68,
      steuer: { art: "ust", jahr: 2025, posten: "steuer" },
    });

    expect(await zeilen(transaction)).toEqual([
      { account: "1790", debit: 0, credit: 503_68 },
      { account: "1800", debit: 503_68, credit: 0 },
    ]);
  });

  it("bucht im SKR04 bei Soll-Versteuerung die Privatentnahme 2100 gegen 3820", async () => {
    await firma("SKR04", "einzelunternehmen", "soll");
    const account = await konto("privat", "DKB Girokonto", "DE13120300000012099776");
    const transaction = await umsatz(account, "2026-10-12", 87_73);

    await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: transaction, amount: 87_73 });

    expect(await zeilen(transaction)).toEqual([
      { account: "2100", debit: 87_73, credit: 0 },
      { account: "3820", debit: 0, credit: 87_73 },
    ]);
  });

  it("bucht in der GmbH gegen das Gesellschafter-Verrechnungskonto", async () => {
    await firma("SKR03", "gmbh");
    const account = await konto("privat", "Gesellschafter privat", "DE13120300000012099776");
    const transaction = await umsatz(account, "2026-10-12", 87_73);

    await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: transaction, amount: 87_73 });

    expect(await zeilen(transaction)).toEqual([
      { account: "0730", debit: 87_73, credit: 0 },
      { account: "1780", debit: 0, credit: 87_73 },
    ]);
  });

  it("bucht eine Zahlung an das Finanzamt vom privaten Konto als Einlage", async () => {
    const account = await konto("privat", "DKB Girokonto", "DE13120300000012099776");
    const transaction = await umsatz(account, "2026-10-12", -87_73);

    await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: transaction, amount: -87_73 });

    expect(await zeilen(transaction)).toEqual([
      { account: "1780", debit: 87_73, credit: 0 },
      { account: "1890", debit: 0, credit: 87_73 },
    ]);
  });
});
