import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Angebot im Bankabgleich auf einem privaten Konto (#873): Kontoführung und Bankgebühren, Zinserträge, Privat und
 * Geldtransit ergeben dort keinen Geschäftsvorfall. Die Oberfläche bietet sie nicht an; der Server lehnt sie auch bei
 * direktem Aufruf ab und schlägt sie nicht vor. Bestehende Zuordnungen bleiben aufhebbar.
 */
describe.skipIf(!testDatabaseUrl)("Privates Konto: Buchungsarten ohne Geschäftsvorfall (Postgres)", () => {
  let bank: typeof import("./bank.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const GESCHAEFT_IBAN = "DE02100100100006820101";
  const PRIVAT_IBAN = "DE75512108001245126199";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./bank.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate allocations, journal_lines, journal_entries, bank_transactions, bank_imports, bank_accounts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', 'SKR03', 'ist')`;
  });

  async function firma(kontenrahmen: "SKR03" | "SKR04", rechtsform: "einzelunternehmen" | "gmbh") {
    await sql`update company set kontenrahmen = ${kontenrahmen}, rechtsform = ${rechtsform} where id = 1`;
  }

  async function konto(purpose: string, iban: string): Promise<string> {
    const [account] = await sql`insert into bank_accounts (name, iban, purpose) values (${purpose}, ${iban}, ${purpose}) returning id`;
    return (account as { id: string }).id;
  }

  let n = 0;
  async function umsatz(accountId: string, amount: number, counterpartyName: string, counterpartyIban: string | null = null): Promise<string> {
    n += 1;
    const [import_] = await sql`
      insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${accountId}, 'umsatz.csv', ${String(n).padStart(64, "0")}, 'swan', 1, 0) returning id`;
    const [transaction] = await sql`
      insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, counterparty_iban, dedup_hash)
      values (${accountId}, ${(import_ as { id: string }).id}, '2026-10-15', ${amount}, ${counterpartyName}, ${counterpartyIban}, ${`h${n}`})
      returning id`;
    return (transaction as { id: string }).id;
  }

  const journalzeilen = async () => Number((await sql`select count(*)::int as n from journal_lines`)[0]!.n);

  for (const [kontenrahmen, rechtsform] of [
    ["SKR03", "einzelunternehmen"],
    ["SKR04", "gmbh"],
  ] as const) {
    it(`lehnt Gebühren, Zinserträge, Privat und Geldtransit auf dem privaten Konto ab (${kontenrahmen}, ${rechtsform})`, async () => {
      await firma(kontenrahmen, rechtsform);
      const privat = await konto("privat", PRIVAT_IBAN);
      for (const [kind, amount] of [
        ["gebuehren", -9_90],
        ["zinsertrag", 1_23],
        ["privat", -50_00],
        ["geldtransit", -100_00],
      ] as const) {
        const transaction = await umsatz(privat, amount, "Sparkasse");
        await expect(bank.allocate(actor, { kind, transactionId: transaction, amount }), kind).rejects.toThrow(/privaten Konto/);
      }
      expect(await journalzeilen()).toBe(0);
    });
  }

  it("lehnt die Spende auf dem privaten Konto ab (SKR03, Einzelunternehmen)", async () => {
    await firma("SKR03", "einzelunternehmen");
    const privat = await konto("privat", PRIVAT_IBAN);
    const transaction = await umsatz(privat, -25_00, "Spendenempfänger");
    // 1840 gegen 2250 ist privat gegen privat; auf einem privaten Konto hat das nichts zu suchen (#873)
    await expect(bank.allocate(actor, { kind: "spende", transactionId: transaction, amount: -25_00 })).rejects.toThrow(/privaten Konto/);
    expect(await journalzeilen()).toBe(0);
  });

  it("lehnt die Gebühr auch als Teil einer Aufteilung ab", async () => {
    const privat = await konto("privat", PRIVAT_IBAN);
    const transaction = await umsatz(privat, -100_00, "Sparkasse");
    await expect(
      bank.allocateSplit(actor, {
        transactionId: transaction,
        parts: [
          { kind: "ustVorauszahlung", amount: -90_10 },
          { kind: "gebuehren", amount: -9_90 },
        ],
      }),
    ).rejects.toThrow(/privaten Konto/);
    expect(await journalzeilen()).toBe(0);
  });

  it("lehnt einen Geldtransit zwischen Geschäfts- und Privatkonto ab", async () => {
    const geschaeft = await konto("geschaeft", GESCHAEFT_IBAN);
    const privat = await konto("privat", PRIVAT_IBAN);
    const ab = await umsatz(geschaeft, -500_00, "Ich", PRIVAT_IBAN);
    const an = await umsatz(privat, 500_00, "Ich", GESCHAEFT_IBAN);
    await expect(bank.allocateTransfer(actor, { transactionId: ab, counterpartId: an })).rejects.toThrow(/privaten Konto/);
    expect(await journalzeilen()).toBe(0);
  });

  it("schlägt auf dem privaten Konto weder „Privat“ für den Übertrag noch gelernte Gebühren vor", async () => {
    const geschaeft = await konto("geschaeft", GESCHAEFT_IBAN);
    const privat = await konto("privat", PRIVAT_IBAN);
    // Übertrag vom Geschäftskonto: auf dem Geschäftskonto die Entnahme, auf dem privaten Konto kein Geschäftsvorfall
    const an = await umsatz(privat, 500_00, "Ich", GESCHAEFT_IBAN);
    expect((await bank.transactionDetail(an))?.direct?.kind ?? null).toBeNull();
    // Kontoführung der Sparkasse zweimal auf dem Geschäftskonto als Gebühr gebucht: gelernt, aber nicht für das Privatkonto
    for (const amount of [-9_90, -9_91]) {
      const t = await umsatz(geschaeft, amount, "Sparkasse");
      await bank.allocate(actor, { kind: "gebuehren", transactionId: t, amount });
    }
    const gebuehr = await umsatz(privat, -9_92, "Sparkasse");
    expect((await bank.transactionDetail(gebuehr))?.direct?.kind ?? null).toBeNull();
    const auchGeschaeft = await umsatz(geschaeft, -9_93, "Sparkasse");
    expect((await bank.transactionDetail(auchGeschaeft))?.direct?.kind).toBe("gebuehren");
  });

  it("Gegenprobe: auf dem Geschäftskonto bucht die Gebühr; wird das Konto privat, bleibt sie aufhebbar", async () => {
    const geschaeft = await konto("geschaeft", GESCHAEFT_IBAN);
    const transaction = await umsatz(geschaeft, -9_90, "Sparkasse");
    await bank.allocate(actor, { kind: "gebuehren", transactionId: transaction, amount: -9_90 });
    await sql`update bank_accounts set purpose = 'privat' where id = ${geschaeft}`;
    const detail = await bank.transactionDetail(transaction);
    expect(detail?.allocations.map((a) => a.kind)).toEqual(["gebuehren"]);
    await bank.reverseAllocation(actor, detail!.allocations[0]!.id, "2026-10-15");
    expect((await bank.transactionDetail(transaction))?.transaction.open).toBe(-9_90);
  });
});
