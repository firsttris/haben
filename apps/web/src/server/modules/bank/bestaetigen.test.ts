import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Vorschläge der Bankliste bestätigen (#1440): Ein Umsatz oder alle markierten, bucht genau den Vorschlag, alles oder nichts.
 */

function dkbCsv(rows: [date: string, name: string, purpose: string, amount: string][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows
    .map(([date, name, purpose, amount]) =>
      [
        date,
        date,
        "Gebucht",
        amount.startsWith("-") ? "Nordlicht" : name,
        amount.startsWith("-") ? name : "Nordlicht",
        purpose,
        amount.startsWith("-") ? "Ausgang" : "Eingang",
        "",
        amount,
        "",
        "",
        "",
      ]
        .map((c) => `"${c}"`)
        .join(";"),
    )
    .join("\n");
  return { bytes: new TextEncoder().encode(`﻿${header}${columns}${body}\n`), filename: "auszug.csv" };
}

describe.skipIf(!testDatabaseUrl)("Vorschläge bestätigen (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let bestaetigen: typeof import("./bestaetigen.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    bestaetigen = await import("./bestaetigen.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma() {
    await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform,
                                   kleinunternehmer, datev_berater_nr, datev_mandant_nr)
      values (1, 'Nordlicht Software', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB',
              'SKR03', 'soll', 'einzelunternehmen', false, '29098', '55003')`;
  }

  const idVon = async (purpose: string) => (await sql<{ id: string }[]>`select id from bank_transactions where purpose = ${purpose}`)[0]!.id;
  const zuordnungen = async () => (await sql`select count(*)::int as n from allocations`)[0]!.n as number;

  /** Vier Zahlungen derselben Gegenpartei: zwei werden von Hand gebucht, daraus lernt Haben den Vorschlag für die übrigen (ab zwei Buchungen) */
  async function mitGelerntemVorschlag() {
    await firma();
    await bank.importStatement(
      actor,
      dkbCsv([
        ["13.10.26", "Erika Beispiel", "Reparatur eins", "119,00"],
        ["14.10.26", "Erika Beispiel", "Reparatur zwei", "119,00"],
        ["15.10.26", "Erika Beispiel", "Reparatur drei", "119,00"],
        ["15.10.26", "Erika Beispiel", "Reparatur vier", "119,00"],
        ["16.10.26", "Unbekannt AG", "Etwas anderes", "42,00"],
      ]),
      null,
    );
    for (const purpose of ["Reparatur eins", "Reparatur zwei"]) {
      await bank.allocate(actor, {
        kind: "kategorie",
        transactionId: await idVon(purpose),
        amount: 119_00,
        kategorie: { kategorie: "erloese", steuersatz: 1900 },
      });
    }
  }

  async function vorschlaege() {
    const konten = await bank.listAccounts();
    const rows = await bank.listTransactions(
      konten.map((k) => k.id),
      "offen",
      "",
    );
    const { mitHinweisen } = await import("./umsatzauswahl.ts");
    return mitHinweisen(rows, await bank.openItems(), await bank.ownAccounts(), konten);
  }

  it("die Liste liefert den Vorschlag zum Bestätigen nur dort, wo er sich ohne Rückfrage buchen lässt", async () => {
    await mitGelerntemVorschlag();
    const rows = await vorschlaege();
    const zwei = rows.find((r) => r.purpose === "Reparatur drei");
    expect(zwei?.bestaetigung).toMatchObject({ text: "Erlöse 19 %", input: { kind: "kategorie", amount: 119_00 } });
    expect(rows.find((r) => r.purpose === "Etwas anderes")?.bestaetigung).toBeNull();
  });

  it("bucht alle markierten Umsätze mit genau dem gezeigten Vorschlag", async () => {
    await mitGelerntemVorschlag();
    const vorher = await zuordnungen();
    await bestaetigen.bestaetigeVorschlaege(actor, [await idVon("Reparatur drei"), await idVon("Reparatur vier")]);
    expect(await zuordnungen()).toBe(vorher + 2);
    const salden = await sql<{ account: string; saldo: number }[]>`
      select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l join journal_entries e on e.id = l.entry_id
       where e.source_type = 'allocation' group by l.account having sum(l.debit - l.credit) <> 0 order by l.account`;
    // Vier Zahlungen zu je 119 €: dieselbe Buchung wie das Zuordnen von Hand
    expect(Object.fromEntries(salden.map((r) => [r.account, r.saldo]))).toEqual({ "1200": 476_00, "1776": -76_00, "8400": -400_00 });
  });

  it("bucht nichts, wenn ein markierter Umsatz keinen Vorschlag hat, und nennt ihn", async () => {
    await mitGelerntemVorschlag();
    const vorher = await zuordnungen();
    await expect(bestaetigen.bestaetigeVorschlaege(actor, [await idVon("Reparatur drei"), await idVon("Etwas anderes")])).rejects.toThrow(
      /Unbekannt AG vom 16\.10\.2026.*nichts gebucht/,
    );
    expect(await zuordnungen()).toBe(vorher);
  });

  it("bucht nichts, wenn ein Umsatz mitten im Stapel scheitert", async () => {
    await mitGelerntemVorschlag();
    const zwei = await idVon("Reparatur drei");
    const vorher = await zuordnungen();
    // Schon zugeordnet: Der Vorschlag ist weg, der ganze Stapel wird abgelehnt
    await bank.allocate(actor, { kind: "privat", transactionId: await idVon("Reparatur vier"), amount: 119_00 });
    await expect(bestaetigen.bestaetigeVorschlaege(actor, [zwei, await idVon("Reparatur vier")])).rejects.toThrow(/nichts gebucht/);
    expect(await zuordnungen()).toBe(vorher + 1);
  });

  it("ein einzelner Umsatz lässt sich bestätigen, ein leerer Stapel nicht", async () => {
    await mitGelerntemVorschlag();
    await bestaetigen.bestaetigeVorschlaege(actor, [await idVon("Reparatur drei")]);
    expect((await sql`select kind from allocations order by created_at desc limit 1`)[0]!.kind).toBe("kategorie");
    await expect(bestaetigen.bestaetigeVorschlaege(actor, [])).rejects.toThrow(/Kein Umsatz/);
  });
});
