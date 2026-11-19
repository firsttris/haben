import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Umsatzsteuer über ein privates Konto in der EÜR (#866, #867). Die Buchung steht gegen Entnahme bzw. Einlage
 * (ust-privat-konto.test.ts), Betriebseinnahme bzw. -ausgabe bleibt die Steuer trotzdem: Bei der Gewinnermittlung nach
 * § 4 Abs. 3 EStG ist die vom Finanzamt erstattete Umsatzsteuer Betriebseinnahme, die an das Finanzamt gezahlte
 * Betriebsausgabe, jeweils im Jahr des Zu- bzw. Abflusses (§ 11 EStG). Über welches Konto das Geld fließt, ändert daran
 * nichts; das private Konto macht daraus nur zusätzlich eine Entnahme bzw. Einlage (§ 4 Abs. 1 Satz 2 und 8 EStG).
 * Journal (euerForYear ab journal_ab) und Nebenbücher (euerAbgleich) müssen dabei übereinstimmen.
 */
describe.skipIf(!testDatabaseUrl)("USt auf privatem Konto in EÜR und Abgleich (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    reports = await import("../auswertungen/reports.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate allocations, journal_lines, journal_entries, bank_transactions, bank_imports, bank_accounts, vat_returns, company cascade`;
  });

  /** EÜR aus dem Journal ab 2026, damit euerAbgleich das Journal gegen die Nebenbücher prüft */
  async function firma(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY',
              ${kontenrahmen}, ${versteuerung}, 2026)`;
  }

  async function privatkonto(): Promise<string> {
    const [account] = await sql`insert into bank_accounts (name, iban, purpose) values ('DKB Girokonto', 'DE44500105175407324931', 'privat') returning id`;
    return (account as { id: string }).id;
  }

  async function umsatz(accountId: string, date: string, amount: number): Promise<string> {
    const [import_] = await sql`
      insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${accountId}, ${`u${date}${amount}.csv`}, ${`${date}${amount}`.padEnd(64, "a")}, 'swan', 1, 0) returning id`;
    const [transaction] = await sql`
      insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, dedup_hash)
      values (${accountId}, ${(import_ as { id: string }).id}, ${date}, ${amount}, 'Finanzamt', ${`h${date}${amount}`})
      returning id`;
    return (transaction as { id: string }).id;
  }

  async function vermerk(month: number, kz83: number): Promise<string> {
    const [row] = await sql`insert into vat_returns (year, month, kz83, status, sent_at) values (2026, ${month}, ${kz83}, 'sent', now()) returning id`;
    return (row as { id: string }).id;
  }

  const zeile = (euer: Awaited<ReturnType<typeof reports.euerForYear>>, key: string) =>
    [...euer.einnahmen, ...euer.ausgaben].find((l) => l.key === key)?.amount ?? 0;

  async function ohneAbweichung(jahr: number) {
    const { zeilen } = await abgleich.euerAbgleich(jahr);
    expect(abgleich.abweichungen(zeilen)).toEqual([]);
    return zeilen;
  }

  for (const [kontenrahmen, versteuerung] of [
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const) {
    it(`zählt Erstattung und Zahlung über das private Konto in der EÜR, Abgleich ohne Abweichung (${kontenrahmen}, ${versteuerung})`, async () => {
      // § 4 Abs. 3 mit § 11 Abs. 1 und 2 EStG: Erstattungen (mit und ohne Bezug auf die Voranmeldung, auch für das Vorjahr)
      // sind Einnahme, die Zahlung Ausgabe, im Jahr des Zu- bzw. Abflusses. Das gilt bei Soll- wie Ist-Versteuerung, die
      // nur bestimmt, wann die Umsatzsteuer entsteht (§§ 13, 20 UStG), nicht den Gewinn
      await firma(kontenrahmen, versteuerung);
      const konto = await privatkonto();
      const erstattung = await umsatz(konto, "2026-05-12", 87_73);
      const zahlung = await umsatz(konto, "2026-06-10", -50_00);
      const vorjahr = await umsatz(konto, "2026-07-01", 120_00);
      await bank.allocate(actor, { kind: "ustva", transactionId: erstattung, vatReturnId: await vermerk(4, -87_73), amount: 87_73 });
      await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: zahlung, amount: -50_00 });
      await bank.allocate(actor, { kind: "steuer", transactionId: vorjahr, amount: 120_00, steuer: { art: "ust", jahr: 2025, posten: "steuer" } });

      const euer = await reports.euerForYear(2026);
      expect(zeile(euer, "erstatteteUst")).toBe(87_73 + 120_00);
      expect(zeile(euer, "gezahlteUst")).toBe(50_00);
      // Sonst nichts gebucht: der Gewinn ist genau Erstattungen minus Zahlung, Entnahme und Einlage ändern ihn nicht
      expect(euer.gewinn).toBe(87_73 + 120_00 - 50_00);
      // Auch der Gewinn nach der DATEV-Formel stimmt, nicht nur die Umsatzsteuerzeile
      const zeilen = await ohneAbweichung(2026);
      expect(zeilen.find((z) => z.posten === "EÜR: Gewinn nach der DATEV-Formel")).toMatchObject({ journal: euer.gewinn, quelle: euer.gewinn });
    });
  }

  it("zählt die Dezember-Zahllast, bis 10. Januar vom privaten Konto gezahlt, im Vorjahr (§ 11 Abs. 2 Satz 2 EStG)", async () => {
    // Umsatzsteuer-Vorauszahlung ist regelmäßig wiederkehrende Ausgabe; die für Dezember ist ohne Dauerfristverlängerung am
    // 10. Januar fällig (§ 18 Abs. 1 Satz 4 UStG) und am 8. Januar gezahlt, beides innerhalb kurzer Zeit nach dem Jahresende:
    // Sie gilt als im Vorjahr abgeflossen (§ 11 Abs. 2 Satz 2 mit Abs. 1 Satz 2 EStG), auch vom privaten Konto
    await firma("SKR03", "ist");
    const konto = await privatkonto();
    const zahlung = await umsatz(konto, "2027-01-08", -300_00);
    await bank.allocate(actor, { kind: "ustva", transactionId: zahlung, vatReturnId: await vermerk(12, 300_00), amount: -300_00 });

    expect(zeile(await reports.euerForYear(2026), "gezahlteUst")).toBe(300_00);
    expect(zeile(await reports.euerForYear(2027), "gezahlteUst")).toBe(0);
    for (const jahr of [2026, 2027]) await ohneAbweichung(jahr);
    // Die Buchung behält ihr Datum, nur die EÜR rechnet sie dem Vorjahr zu
    const [buchung] = await sql<{ date: string }[]>`
      select to_char(e.date, 'YYYY-MM-DD') as date from journal_entries e join allocations a on a.id = e.source_id
      where e.source_type = 'allocation' and a.transaction_id = ${zahlung}`;
    expect(buchung?.date).toBe("2027-01-08");
  });

  it("hebt die Erstattung auf dem privaten Konto ohne Bankzeile auf, die Voranmeldung ist wieder offen", async () => {
    // GoBD Rz. 58 ff. (Unveränderbarkeit, § 146 Abs. 4 AO): Aufheben bucht eine Gegenbuchung, die ursprüngliche bleibt
    // stehen. Danach ist nichts zugeflossen, das per Saldo als Einnahme zählt (§ 11 Abs. 1 EStG), und die Konten sind
    // ausgeglichen; die Bank kommt in keiner der beiden Buchungen vor
    await firma("SKR03", "ist");
    const konto = await privatkonto();
    const erstattung = await umsatz(konto, "2026-05-12", 87_73);
    const returnId = await vermerk(4, -87_73);
    await bank.allocate(actor, { kind: "ustva", transactionId: erstattung, vatReturnId: returnId, amount: 87_73 });
    const [allocation] = await sql<{ id: string }[]>`select id from allocations where transaction_id = ${erstattung}`;
    await bank.reverseAllocation(actor, allocation!.id, "2026-05-20");

    const salden = await sql<{ account: string; saldo: number }[]>`
      select account, sum(debit - credit)::int as saldo from journal_lines group by account order by account`;
    expect(salden).toEqual([
      { account: "1780", saldo: 0 },
      { account: "1800", saldo: 0 },
    ]);
    const [{ buchungen } = { buchungen: 0 }] = await sql<{ buchungen: number }[]>`select count(*)::int as buchungen from journal_entries`;
    expect(buchungen).toBe(2);
    expect(zeile(await reports.euerForYear(2026), "erstatteteUst")).toBe(0);
    await ohneAbweichung(2026);

    // Neu zuordnen geht wieder, die Voranmeldung ist also offen
    await bank.allocate(actor, { kind: "ustva", transactionId: erstattung, vatReturnId: returnId, amount: 87_73 });
    expect(zeile(await reports.euerForYear(2026), "erstatteteUst")).toBe(87_73);
    await ohneAbweichung(2026);
  });
});
