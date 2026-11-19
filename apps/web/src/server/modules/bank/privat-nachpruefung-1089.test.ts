import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Nachprüfung #1089 (Kennzeichnung „privat, kein Betriebsvorgang", #1088): Randfälle nach dem Kennzeichnen.
 */
describe.skipIf(!testDatabaseUrl)("Nachprüfung: privater Umsatz ohne Buchungsart (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let search: typeof import("./search.ts");
  let privat: typeof import("./privat.ts");
  let auswahl: typeof import("./umsatzauswahl.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let verrechnung: typeof import("./neutralisierung.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    search = await import("./search.ts");
    privat = await import("./privat.ts");
    auswahl = await import("./umsatzauswahl.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
    verrechnung = await import("./neutralisierung.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(
      sql,
    )`truncate bank_private_marks, bank_neutralizations, allocations, journal_lines, journal_entries, bank_transactions, bank_imports, bank_accounts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', 'SKR03', 'ist')`;
  });

  async function konto(purpose: string, name: string, iban: string): Promise<string> {
    const [account] = await sql`insert into bank_accounts (name, iban, purpose) values (${name}, ${iban}, ${purpose}) returning id`;
    return (account as { id: string }).id;
  }

  async function umsatz(accountId: string, date: string, amount: number, purpose = "ERSTATT. EINK.ST 2025"): Promise<string> {
    const [import_] = await sql`
      insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${accountId}, 'umsatz.csv', ${"a".repeat(64)}, 'swan', 1, 0) returning id`;
    const [transaction] = await sql`
      insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, purpose, dedup_hash)
      values (${accountId}, ${(import_ as { id: string }).id}, ${date}, ${amount}, 'Finanzamt', ${purpose}, ${`h${date}${amount}`})
      returning id`;
    return (transaction as { id: string }).id;
  }

  // BankPrivat.tsx: „Zuordnen", „Direkt buchen" und „Aufteilen" gelten erst, wenn die Kennzeichnung aufgehoben ist.
  // Sonst ist der Umsatz zugleich gebucht und „privat, kein Betriebsvorgang", und ein Rest bleibt unsichtbar offen.
  it("lehnt eine Zuordnung auf einen gekennzeichneten Umsatz ab, solange die Kennzeichnung besteht", async () => {
    const privatKonto = await konto("privat", "Privatkonto", "DE44500105175407324931");
    const id = await umsatz(privatKonto, "2026-11-11", 119_00, "Kunde zahlt auf Privatkonto");
    await privat.markierePrivat(actor, id, "versehentlich");

    await expect(
      bank.allocate(actor, { kind: "kategorie", transactionId: id, amount: 50_00, kategorie: { kategorie: "erloese", steuersatz: 1900 } }),
    ).rejects.toThrow();
  });

  it("zeigt einen teilweise gebuchten Umsatz nicht als privat, sondern weiter mit offenem Rest", async () => {
    const privatKonto = await konto("privat", "Privatkonto", "DE44500105175407324931");
    const id = await umsatz(privatKonto, "2026-11-11", 119_00, "Kunde zahlt auf Privatkonto");
    await privat.markierePrivat(actor, id);
    // Wird die Zuordnung (anders als erwartet) angenommen, darf der Rest nicht aus den offenen Posten fallen
    await bank
      .allocate(actor, { kind: "kategorie", transactionId: id, amount: 50_00, kategorie: { kategorie: "erloese", steuersatz: 1900 } })
      .catch(() => undefined);
    const offen = (
      await sql`select amount - coalesce((select sum(amount) from allocations where transaction_id = ${id}), 0) as rest from bank_transactions where id = ${id}`
    )[0] as {
      rest: number;
    };
    if (Number(offen.rest) !== 119_00) {
      expect((await bank.listAccounts()).find((a) => a.id === privatKonto)?.openCount).toBe(1);
    }
  });

  // Die Kennzeichnung gilt nur auf einem privaten Konto (privat.ts, docs/bank.md). Wird das Konto zum Geschäftskonto,
  // ist ein offener Eingang dort wieder ein offener Posten; die Vorprüfung der Voranmeldung muss ihn nennen.
  it("zählt einen gekennzeichneten Eingang wieder als offen, wenn das Konto zum Geschäftskonto wird", async () => {
    const november = { year: 2026, month: 11 } as const;
    const kontoId = await konto("privat", "Girokonto", "DE44500105175407324931");
    const id = await umsatz(kontoId, "2026-11-11", 1_032_197);
    await privat.markierePrivat(actor, id);

    await bank.updateAccount(actor, { id: kontoId, name: "Girokonto", purpose: "geschaeft" });

    expect((await bank.listAccounts()).find((a) => a.id === kontoId)?.openCount).toBe(1);
    const vorpruefung = (await figures.preflight(november, await figures.computeVatFigures(november))).map((i) => i.text);
    expect(vorpruefung).toEqual([expect.stringContaining("1 Zahlungseingang im Zeitraum noch nicht zugeordnet")]);
  });

  // Kommt das Konto mit einer Teilzuordnung zurück auf privat, gilt die alte Kennzeichnung nicht: Der Rest bleibt bei
  // Ist-Versteuerung ein offener Eingang, dem sonst Umsatzsteuer fehlt (vat-figures.ts, preflight).
  it("zählt einen teilweise zugeordneten Eingang nach dem Wechsel zurück auf privat als offen (Ist)", async () => {
    const november = { year: 2026, month: 11 } as const;
    const kontoId = await konto("privat", "Girokonto", "DE44500105175407324931");
    const id = await umsatz(kontoId, "2026-11-11", 119_00, "Kunde zahlt auf Privatkonto");
    await privat.markierePrivat(actor, id);
    await bank.updateAccount(actor, { id: kontoId, name: "Girokonto", purpose: "geschaeft" });
    await bank.allocate(actor, { kind: "kategorie", transactionId: id, amount: 50_00, kategorie: { kategorie: "erloese", steuersatz: 1900 } });
    await bank.updateAccount(actor, { id: kontoId, name: "Girokonto", purpose: "privat" });

    expect((await bank.listAccounts()).find((a) => a.id === kontoId)?.openCount).toBe(1);
    const liste = await auswahl.umsatzauswahl([{ id: kontoId, purpose: "privat" }], "offen", "", { feld: "datum", richtung: "ab" });
    expect(liste.map((row) => [row.id, row.hint])).toEqual([[id, "teilweise"]]);
    const vorpruefung = (await figures.preflight(november, await figures.computeVatFigures(november))).map((i) => i.text);
    expect(vorpruefung).toContainEqual(expect.stringContaining("1 Zahlungseingang im Zeitraum noch nicht zugeordnet; bei Ist-Versteuerung"));
  });

  // search.ts: Der Hinweis der Schnellsuche soll wie `mitHinweisen` in umsatzauswahl.ts sein (TransactionStatus)
  it("zeigt in der Schnellsuche denselben Status wie in der Umsatzliste", async () => {
    const privatKonto = await konto("privat", "Privatkonto", "DE44500105175407324931");
    const id = await umsatz(privatKonto, "2026-11-11", 1_032_197);
    await privat.markierePrivat(actor, id);

    const liste = await auswahl.umsatzauswahl([{ id: privatKonto, purpose: "privat" }], "alle", "", { feld: "datum", richtung: "ab" });
    expect(liste.find((row) => row.id === id)?.hint).toBe("privat");
    const treffer = (await search.searchBank("EINK.ST", ["bankTransactions"])).bankTransactions!.hits.find((t) => t.id === id);
    expect(String(treffer?.hint)).toBe("privat");
  });
  // Der Bankabgleich bietet einen gekennzeichneten Umsatz als Gegenstück einer Verrechnung an (neutralisierung.ts,
  // candidates); danach ist er zugleich verrechnet und „privat". Wie die Zuordnung gilt das erst nach dem Aufheben.
  it("bietet einen gekennzeichneten Umsatz nicht zur Verrechnung an und lehnt sie ab", async () => {
    const privatKonto = await konto("privat", "Privatkonto", "DE44500105175407324931");
    const erstattung = await umsatz(privatKonto, "2026-11-11", 250_00);
    const ueberweisung = await umsatz(privatKonto, "2026-11-12", -250_00, "Übertrag Sparkonto");
    await privat.markierePrivat(actor, erstattung);

    expect((await verrechnung.neutralizationView(ueberweisung)).candidates.map((c) => c.id)).not.toContain(erstattung);
    await expect(
      verrechnung.neutralizeTransactions(actor, { transactionId: ueberweisung, counterTransactionId: erstattung, note: "hebt sich auf" }),
    ).rejects.toThrow();
  });

  // Ein Umsatz, dessen Zuordnung aufgehoben wurde, ist wieder ganz offen (bankOpenAmountSql) und muss sich
  // kennzeichnen lassen; das gilt ebenso nach einer aufgehobenen Verrechnung (privat.ts, `hindernis`).
  it("kennzeichnet einen Umsatz, dessen Zuordnung aufgehoben wurde", async () => {
    const privatKonto = await konto("privat", "Privatkonto", "DE44500105175407324931");
    const id = await umsatz(privatKonto, "2026-11-11", 119_00, "Kunde zahlt auf Privatkonto");
    await bank.allocate(actor, { kind: "kategorie", transactionId: id, amount: 119_00, kategorie: { kategorie: "erloese", steuersatz: 1900 } });
    const [al] = await sql`select id from allocations where transaction_id = ${id} and reverses_id is null`;
    await bank.reverseAllocation(actor, (al as { id: string }).id, "2026-11-12");
    expect((await bank.listAccounts()).find((a) => a.id === privatKonto)?.openCount).toBe(1);

    await privat.markierePrivat(actor, id);
    expect((await bank.listAccounts()).find((a) => a.id === privatKonto)?.openCount).toBe(0);
  });

  it("kennzeichnet einen Umsatz, dessen Verrechnung aufgehoben wurde", async () => {
    const privatKonto = await konto("privat", "Privatkonto", "DE44500105175407324931");
    const a = await umsatz(privatKonto, "2026-11-11", 250_00);
    const b = await umsatz(privatKonto, "2026-11-12", -250_00, "Übertrag");
    await verrechnung.neutralizeTransactions(actor, { transactionId: a, counterTransactionId: b, note: "hebt sich auf" });
    const [n] = await sql`select id from bank_neutralizations where reverses_id is null`;
    await verrechnung.reverseNeutralization(actor, (n as { id: string }).id);

    await privat.markierePrivat(actor, a);
    expect((await bank.listAccounts()).find((x) => x.id === privatKonto)?.openCount).toBe(1);
  });
});
