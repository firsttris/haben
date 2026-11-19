import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Ein privater Umsatz ohne Buchungsart (#1088): Auf dem privaten Konto lässt sich eine Einkommensteuer-Erstattung
 * nicht buchen, ohne sie zum Betriebsvorgang zu machen. Die Kennzeichnung nimmt sie aus den offenen Posten, ohne
 * etwas zu buchen.
 */
describe.skipIf(!testDatabaseUrl)("Privater Umsatz ohne Buchungsart (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let privat: typeof import("./privat.ts");
  let auswahl: typeof import("./umsatzauswahl.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    privat = await import("./privat.ts");
    auswahl = await import("./umsatzauswahl.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(
      sql,
    )`truncate bank_private_marks, allocations, journal_lines, journal_entries, bank_transactions, bank_imports, bank_accounts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', 'SKR03', 'ist')`;
  });

  async function konto(purpose: string, name: string, iban: string): Promise<string> {
    const [account] = await sql`insert into bank_accounts (name, iban, purpose) values (${name}, ${iban}, ${purpose}) returning id`;
    return (account as { id: string }).id;
  }

  async function umsatz(accountId: string, date: string, amount: number): Promise<string> {
    const [import_] = await sql`
      insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${accountId}, 'umsatz.csv', ${"a".repeat(64)}, 'swan', 1, 0) returning id`;
    const [transaction] = await sql`
      insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, purpose, dedup_hash)
      values (${accountId}, ${(import_ as { id: string }).id}, ${date}, ${amount}, 'Finanzamt', 'ERSTATT. EINK.ST 2025', ${`h${date}${amount}`})
      returning id`;
    return (transaction as { id: string }).id;
  }

  it("nimmt einen Umsatz auf dem privaten Konto aus den offenen Posten, ohne zu buchen", async () => {
    const privatKonto = await konto("privat", "Privatkonto", "DE44500105175407324931");
    const id = await umsatz(privatKonto, "2026-11-11", 1_032_197);

    const vorher = (await bank.listAccounts()).find((a) => a.id === privatKonto);
    expect(vorher).toMatchObject({ openCount: 1, privateCount: 0 });

    await privat.markierePrivat(actor, id, "Einkommensteuer 2025, privat");

    const nachher = (await bank.listAccounts()).find((a) => a.id === privatKonto);
    expect(nachher).toMatchObject({ openCount: 0, privateCount: 1 });
    // Aus der Liste „offen" ist er raus, aus dem Journal bleibt er sowieso draußen
    expect(await bank.listTransactions(privatKonto, "offen", "")).toEqual([]);
    expect((await bank.listTransactions(privatKonto, "alle", "")).find((t) => t.id === id)?.privat).toBe(true);
    expect(await sql`select count(*)::int as n from journal_entries`).toEqual([{ n: 0 }]);

    // Aufheben stellt den offenen Posten wieder her
    await privat.hebePrivatAuf(actor, id);
    expect((await bank.listAccounts()).find((a) => a.id === privatKonto)).toMatchObject({ openCount: 1, privateCount: 0 });
  });

  it("lässt sich auf einem Geschäftskonto nicht setzen", async () => {
    const geschaeft = await konto("geschaeft", "Geschäftskonto", "DE02120300000000202051");
    const id = await umsatz(geschaeft, "2026-11-11", 1_032_197);
    await expect(privat.markierePrivat(actor, id)).rejects.toThrow(/nur auf einem privaten Konto/);
  });

  /*
   * Die Zeile trug weiter „Offen", während der Filter „offen" sie schon ausschloss — das war inkonsistent. Ein
   * gekennzeichneter Umsatz steht jetzt als „privat, kein Betriebsvorgang" in der Liste.
   */
  it("zeigt einen gekennzeichneten Umsatz als privat statt offen", async () => {
    const privatKonto = await konto("privat", "Privatkonto", "DE44500105175407324931");
    const id = await umsatz(privatKonto, "2026-11-11", 1_032_197);
    const sortierung = { feld: "datum", richtung: "ab" } as const;

    const vorher = await auswahl.umsatzauswahl([{ id: privatKonto, purpose: "privat" }], "alle", "", sortierung);
    expect(vorher.find((row) => row.id === id)?.hint).toBe("offen");

    await privat.markierePrivat(actor, id);

    const nachher = await auswahl.umsatzauswahl([{ id: privatKonto, purpose: "privat" }], "alle", "", sortierung);
    expect(nachher.find((row) => row.id === id)?.hint).toBe("privat");
    // Und in der Arbeitsliste „offen" taucht er nicht auf
    expect(await auswahl.umsatzauswahl([{ id: privatKonto, purpose: "privat" }], "offen", "", sortierung)).toEqual([]);
  });

  it("steht mit Kennzeichnen und Aufheben im Änderungsprotokoll (CLAUDE.md: neue Tabelle mit Audit-Trigger)", async () => {
    const privatKonto = await konto("privat", "Privatkonto", "DE44500105175407324931");
    const id = await umsatz(privatKonto, "2026-11-11", 1_032_197);
    await leeren(sql)`truncate audit_log`;

    await privat.markierePrivat(actor, id, "Einkommensteuer 2025, privat");
    await privat.hebePrivatAuf(actor, id);

    const log = await sql`select actor, action, coalesce(new_value, old_value) ->> 'transaction_id' as umsatz
      from audit_log where table_name = 'bank_private_marks' order by seq`;
    expect(log).toEqual([
      { actor, action: "INSERT", umsatz: id },
      { actor, action: "DELETE", umsatz: id },
    ]);
  });

  it("fehlt nach dem Kennzeichnen auch in der Vorprüfung der Voranmeldung", async () => {
    const november = { year: 2026, month: 11 } as const;
    const privatKonto = await konto("privat", "Privatkonto", "DE44500105175407324931");
    const id = await umsatz(privatKonto, "2026-11-11", 1_032_197);
    const vorpruefung = async () => (await figures.preflight(november, await figures.computeVatFigures(november))).map((i) => i.text);
    expect(await vorpruefung()).toEqual([expect.stringContaining("1 Zahlungseingang im Zeitraum noch nicht zugeordnet")]);

    await privat.markierePrivat(actor, id);

    // bank-open.ts: Bankabgleich, Kontenliste und Vorprüfung rechnen den offenen Betrag gleich
    expect(await vorpruefung()).toEqual([]);
  });
});
