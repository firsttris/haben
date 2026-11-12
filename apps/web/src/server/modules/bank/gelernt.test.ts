import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { today } from "../../today.ts";

/*
 * Vorschläge ohne Rechnung aus allen früheren Zuordnungen derselben Gegenpartei (#295), mit Postgres: auch „Direkt
 * buchen“ auf eine Kategorie mit Steuersatz (#324) und Zinserträge werden gelernt, jede Kategorie und jeder Satz für
 * sich, mit dem Tag der letzten Zuordnung in der Begründung. Gebucht wird erst auf Klick; hier der Weg vom Vorschlag zur
 * Buchung in SKR03 und SKR04, bei Ist und Soll, und der Wechsel zum Kleinunternehmer.
 */

function dkbCsv(rows: [date: string, name: string, iban: string, purpose: string, amount: string][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows
    .map(([date, name, iban, purpose, amount]) => {
      const out = amount.startsWith("-");
      return [date, date, "Gebucht", out ? "Nordlicht" : name, out ? name : "Nordlicht", purpose, out ? "Ausgang" : "Eingang", iban, amount, "", "", ""]
        .map((c) => `"${c}"`)
        .join(";");
    })
    .join("\n");
  return { bytes: new TextEncoder().encode(`﻿${header}${columns}${body}\n`), filename: "auszug.csv" };
}

/** Heute als TT.MM.JJ: Den Kleinunternehmer-Stand liest Haben aus dem Änderungsprotokoll nach Tag */
const heute = today();
const heuteDkb = `${heute.slice(8, 10)}.${heute.slice(5, 7)}.${heute.slice(2, 4)}`;

describe.skipIf(!testDatabaseUrl)("Vorschläge aus früheren Zuordnungen (Postgres)", () => {
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

  async function firma(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", kleinunternehmer = false) {
    await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, kleinunternehmer)
      values (1, 'Nordlicht Software', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB',
              ${kontenrahmen}, ${versteuerung}, ${kleinunternehmer})`;
  }

  const umsatz = async (amount: number) => (await sql<{ id: string }[]>`select id from bank_transactions where amount = ${amount}`)[0]!.id;

  /** Buchungen aus Zuordnungen eines Umsatzes, je Konto Soll − Haben */
  async function salden(transactionId: string) {
    const rows = await sql<{ account: string; saldo: number }[]>`
      select l.account, sum(l.debit - l.credit)::int as saldo
        from journal_lines l join journal_entries e on e.id = l.entry_id join allocations a on a.id = e.source_id
       where e.source_type = 'allocation' and a.transaction_id = ${transactionId}
       group by l.account having sum(l.debit - l.credit) <> 0 order by l.account`;
    return Object.fromEntries(rows.map((r) => [r.account, r.saldo]));
  }

  it.each([
    ["SKR03", "ist", { bank: "1200", erloese: "8300", ust: "1771", telefon: "4920" }],
    ["SKR03", "soll", { bank: "1200", erloese: "8300", ust: "1771", telefon: "4920" }],
    ["SKR04", "ist", { bank: "1800", erloese: "4300", ust: "3801", telefon: "6805" }],
    ["SKR04", "soll", { bank: "1800", erloese: "4300", ust: "3801", telefon: "6805" }],
  ] as const)(
    "%s, %s: Kategorie und Steuersatz aus früheren Direktbuchungen, gebucht erst auf Bestätigung",
    async (kr, versteuerung, konten) => {
      await firma(kr, versteuerung);
      await bank.importStatement(
        actor,
        dkbCsv([
          // Ein Privatkunde zahlt regelmäßig Leistungen mit 7 %, über seine IBAN erkannt
          ["03.08.26", "Erika Beispiel", "DE02100100100006820101", "Gartenpflege Juli", "107,00"],
          ["02.09.26", "Erika Beispiel", "DE02100100100006820101", "Gartenpflege August", "214,00"],
          ["01.10.26", "Erika Beispiel", "DE02100100100006820101", "Gartenpflege September", "321,00"],
          // Prepaid-Aufladungen ohne IBAN, über den Namen erkannt
          ["05.08.26", "Kiosk am Markt", "", "Prepaid-Aufladung", "-15,00"],
          ["05.09.26", "Kiosk am Markt", "", "Prepaid-Aufladung", "-20,00"],
          ["05.10.26", "Kiosk am Markt", "", "Prepaid-Aufladung", "-25,00"],
        ]),
        null,
      );
      // Noch keine Vorgeschichte: kein Vorschlag
      expect((await bank.transactionDetail(await umsatz(321_00)))?.direct).toBeNull();

      for (const amount of [107_00, 214_00]) {
        await bank.allocate(actor, { kind: "kategorie", transactionId: await umsatz(amount), amount, kategorie: { kategorie: "erloese", steuersatz: 700 } });
      }
      for (const amount of [-15_00, -20_00]) {
        await bank.allocate(actor, { kind: "kategorie", transactionId: await umsatz(amount), amount, kategorie: { kategorie: "telefon", steuersatz: 0 } });
      }

      const eingang = await umsatz(321_00);
      const vorschlag = (await bank.transactionDetail(eingang))?.direct;
      expect(vorschlag).toEqual({
        kind: "kategorie",
        kategorie: { kategorie: "erloese", steuersatz: 700 },
        reasons: ["2 von 2 Umsätzen mit dieser Gegen-IBAN so gebucht, zuletzt am 02.09.2026"],
        counterpart: null,
      });
      const ausgang = await umsatz(-25_00);
      expect((await bank.transactionDetail(ausgang))?.direct).toMatchObject({
        kind: "kategorie",
        kategorie: { kategorie: "telefon", steuersatz: 0 },
        reasons: ["2 von 2 Umsätzen von dieser Gegenpartei so gebucht, zuletzt am 05.09.2026"],
      });
      // Auch der Hinweis „Vorschlag“ in der Liste rechnet damit
      const liste = await bank.learnedDirectSuggestions([
        { id: eingang, amount: 321_00, bookingDate: "2026-10-01", counterpartyIban: "DE02100100100006820101", counterpartyName: "Erika Beispiel" },
      ]);
      expect(liste.get(eingang)?.kategorie).toEqual({ kategorie: "erloese", steuersatz: 700 });

      // Nichts ist gebucht, bis bestätigt wird
      expect(await salden(eingang)).toEqual({});
      await bank.allocate(actor, { kind: "kategorie", transactionId: eingang, amount: 321_00, kategorie: vorschlag!.kategorie! });
      await bank.allocate(actor, { kind: "kategorie", transactionId: ausgang, amount: -25_00, kategorie: { kategorie: "telefon", steuersatz: 0 } });
      // 7 % am Tag der Zahlung, bei Ist wie bei Soll; die Ausgabe brutto ohne Vorsteuer
      expect(await salden(eingang)).toEqual({ [konten.bank]: 321_00, [konten.erloese]: -300_00, [konten.ust]: -21_00 });
      expect(await salden(ausgang)).toEqual({ [konten.bank]: -25_00, [konten.telefon]: 25_00 });
    },
    30_000,
  );

  it("Jede Kategorie zählt für sich; eine aufgehobene Direktbuchung zählt nicht", async () => {
    await firma("SKR03", "ist");
    await bank.importStatement(
      actor,
      dkbCsv([
        ["05.07.26", "Kiosk am Markt", "", "Aufladung", "-10,00"],
        ["05.08.26", "Kiosk am Markt", "", "Aufladung", "-11,00"],
        ["05.09.26", "Kiosk am Markt", "", "Zeitschriften", "-12,00"],
        ["05.10.26", "Kiosk am Markt", "", "Aufladung", "-13,00"],
      ]),
      null,
    );
    const telefon = { kategorie: "telefon", steuersatz: 0 } as const;
    await bank.allocate(actor, { kind: "kategorie", transactionId: await umsatz(-10_00), amount: -10_00, kategorie: telefon });
    await bank.allocate(actor, { kind: "kategorie", transactionId: await umsatz(-11_00), amount: -11_00, kategorie: telefon });
    await bank.allocate(actor, {
      kind: "kategorie",
      transactionId: await umsatz(-12_00),
      amount: -12_00,
      kategorie: { kategorie: "literatur", steuersatz: 0 },
    });
    // 2 von 3 als Telefon: Mehrheit
    expect((await bank.transactionDetail(await umsatz(-13_00)))?.direct?.reasons).toEqual([
      "2 von 3 Umsätzen von dieser Gegenpartei so gebucht, zuletzt am 05.08.2026",
    ]);
    // Eine Telefon-Buchung aufgehoben: 1 von 2 ist keine Mehrheit mehr
    const [zuordnung] = await sql`select a.id from allocations a join bank_transactions t on t.id = a.transaction_id where t.amount = -1000`;
    await bank.reverseAllocation(actor, zuordnung!.id);
    expect((await bank.transactionDetail(await umsatz(-13_00)))?.direct).toBeNull();
  }, 30_000);

  it("Zinserträge der Bank werden gelernt", async () => {
    await firma("SKR04", "soll");
    const DKB = "DE88120300000000000001";
    await bank.importStatement(
      actor,
      dkbCsv([
        ["30.06.26", "DKB AG", DKB, "Abschluss Zinsen", "1,20"],
        ["30.09.26", "DKB AG", DKB, "Abschluss Zinsen", "1,35"],
        ["31.12.26", "DKB AG", DKB, "Abschluss Zinsen", "1,50"],
      ]),
      null,
    );
    await bank.allocate(actor, { kind: "zinsertrag", transactionId: await umsatz(120), amount: 120 });
    await bank.allocate(actor, { kind: "zinsertrag", transactionId: await umsatz(135), amount: 135 });
    expect((await bank.transactionDetail(await umsatz(150)))?.direct).toEqual({
      kind: "zinsertrag",
      reasons: ["2 von 2 Umsätzen mit dieser Gegen-IBAN so gebucht, zuletzt am 30.09.2026"],
      counterpart: null,
    });
  }, 30_000);

  it("Als Kleinunternehmer keine Erlöse mit Steuer als Vorschlag, etwa aus der Zeit davor: so ließe es sich nicht buchen", async () => {
    await firma("SKR03", "ist", true);
    await bank.importStatement(
      actor,
      dkbCsv([
        [heuteDkb, "Erika Beispiel", "DE02100100100006820101", "Gartenpflege 1", "119,00"],
        [heuteDkb, "Erika Beispiel", "DE02100100100006820101", "Gartenpflege 2", "238,00"],
        [heuteDkb, "Erika Beispiel", "DE02100100100006820101", "Gartenpflege 3", "357,00"],
        [heuteDkb, "Erika Beispiel", "DE02100100100006820101", "Gartenpflege 4", "476,00"],
      ]),
      null,
    );
    // Zwei Zuordnungen mit 19 %, wie vor dem Wechsel gebucht (der Wechsel selbst geht nur zum Jahresanfang)
    for (const amount of [119_00, 238_00]) {
      await sql`insert into allocations (transaction_id, kind, amount, category, tax_rate)
        values (${await umsatz(amount)}, 'kategorie', ${amount}, 'erloese', 1900)`;
    }
    expect((await bank.transactionDetail(await umsatz(476_00)))?.direct).toBeNull();
    // Als Kleinunternehmer ohne Steuer gebucht: das wird vorgeschlagen
    await bank.importStatement(
      actor,
      dkbCsv([
        [heuteDkb, "Hans Muster", "DE02100100100006820102", "Nachhilfe 1", "40,00"],
        [heuteDkb, "Hans Muster", "DE02100100100006820102", "Nachhilfe 2", "41,00"],
        [heuteDkb, "Hans Muster", "DE02100100100006820102", "Nachhilfe 3", "42,00"],
      ]),
      null,
    );
    for (const amount of [40_00, 41_00]) {
      await bank.allocate(actor, { kind: "kategorie", transactionId: await umsatz(amount), amount, kategorie: { kategorie: "erloese", steuersatz: 0 } });
    }
    expect((await bank.transactionDetail(await umsatz(42_00)))?.direct?.kategorie).toEqual({ kategorie: "erloese", steuersatz: 0 });
  }, 30_000);
});
