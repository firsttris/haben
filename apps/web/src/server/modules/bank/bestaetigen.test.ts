import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Vorschläge der Bankliste bestätigen (#1440): Ein Umsatz oder alle markierten, bucht genau den Vorschlag, alles oder nichts.
 */

function dkbCsv(rows: [date: string, name: string, purpose: string, amount: string, iban?: string][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows
    .map(([date, name, purpose, amount, iban]) =>
      [
        date,
        date,
        "Gebucht",
        amount.startsWith("-") ? "Nordlicht" : name,
        amount.startsWith("-") ? name : "Nordlicht",
        purpose,
        amount.startsWith("-") ? "Ausgang" : "Eingang",
        iban ?? "",
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

  async function firma(kontenrahmen = "SKR03", versteuerung = "soll") {
    await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform,
                                   kleinunternehmer, datev_berater_nr, datev_mandant_nr)
      values (1, 'Nordlicht Software', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB',
              ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen', false, '29098', '55003')`;
  }

  const idVon = async (purpose: string) => (await sql<{ id: string }[]>`select id from bank_transactions where purpose = ${purpose}`)[0]!.id;
  const zuordnungen = async () => (await sql`select count(*)::int as n from allocations`)[0]!.n as number;

  /** Vier Zahlungen derselben Gegenpartei: zwei werden von Hand gebucht, daraus lernt Haben den Vorschlag für die übrigen (ab zwei Buchungen) */
  async function mitGelerntemVorschlag(kontenrahmen = "SKR03", versteuerung = "soll") {
    await firma(kontenrahmen, versteuerung);
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

  it("mehr als 200 Umsätze auf einmal lehnt der Server ab, ohne etwas zu buchen", async () => {
    await mitGelerntemVorschlag();
    const vorher = await zuordnungen();
    const ids = Array.from({ length: 201 }, () => crypto.randomUUID());
    await expect(bestaetigen.bestaetigeVorschlaege(actor, ids)).rejects.toThrow(/Höchstens 200 Umsätze/);
    expect(await zuordnungen()).toBe(vorher);
  });

  it("ein einzelner Umsatz lässt sich bestätigen, ein leerer Stapel nicht", async () => {
    await mitGelerntemVorschlag();
    await bestaetigen.bestaetigeVorschlaege(actor, [await idVon("Reparatur drei")]);
    expect((await sql`select kind from allocations order by created_at desc limit 1`)[0]!.kind).toBe("kategorie");
    await expect(bestaetigen.bestaetigeVorschlaege(actor, [])).rejects.toThrow(/Kein Umsatz/);
  });

  /** Zeilen aller Buchungen, die nach `vorher` entstanden sind, ohne Ids: Konto, Soll, Haben */
  async function neueZeilen(vorher: Set<string>) {
    const rows = await sql<{ id: string; zeilen: string }[]>`
      select e.id, string_agg(l.account || ':' || l.debit || ':' || l.credit, ' ' order by l.account, l.debit, l.credit) as zeilen
        from journal_entries e join journal_lines l on l.entry_id = e.id where e.source_type = 'allocation' group by e.id`;
    return rows.filter((r) => !vorher.has(r.id)).map((r) => r.zeilen);
  }
  const alleBuchungen = async () => new Set((await sql<{ id: string }[]>`select id from journal_entries`).map((r) => r.id));

  it.each([
    ["SKR03", "soll"],
    ["SKR04", "soll"],
    ["SKR03", "ist"],
    ["SKR04", "ist"],
  ])("bestätigen bucht dasselbe wie Zuordnen von Hand (%s, %s-Versteuerung)", async (kontenrahmen, versteuerung) => {
    await mitGelerntemVorschlag(kontenrahmen, versteuerung);
    const vorher = await alleBuchungen();
    await bestaetigen.bestaetigeVorschlaege(actor, [await idVon("Reparatur drei")]);
    const bestaetigt = await neueZeilen(vorher);
    const dazwischen = await alleBuchungen();
    await bank.allocate(actor, {
      kind: "kategorie",
      transactionId: await idVon("Reparatur vier"),
      amount: 119_00,
      kategorie: { kategorie: "erloese", steuersatz: 1900 },
    });
    const vonHand = await neueZeilen(dazwischen);
    expect(bestaetigt.length).toBeGreaterThan(0);
    expect(bestaetigt).toEqual(vonHand);
  });

  it("die Regel der Kontozwecke geht dem Gelernten vor, wie in der Detailansicht", async () => {
    await firma();
    const iban = "DE02120300000000202051";
    await bank.importStatement(
      actor,
      dkbCsv([
        ["13.10.26", "Tagesgeld Nordlicht", "Umbuchung eins", "-500,00", iban],
        ["14.10.26", "Tagesgeld Nordlicht", "Umbuchung zwei", "-500,00", iban],
        ["15.10.26", "Tagesgeld Nordlicht", "Umbuchung drei", "-500,00", iban],
      ]),
      null,
    );
    // Noch ist die IBAN kein eigenes Konto: zweimal als Privat gebucht, daraus lernt Haben „Privat“
    for (const purpose of ["Umbuchung eins", "Umbuchung zwei"]) {
      await bank.allocate(actor, { kind: "privat", transactionId: await idVon(purpose), amount: -500_00 });
    }
    expect((await vorschlaege()).find((r) => r.purpose === "Umbuchung drei")?.bestaetigung?.text).toBeDefined();
    // Jetzt gibt es das Konto in Haben: die Regel sagt Geldtransit, das ist nicht bestätigbar
    await sql`insert into bank_accounts (name, iban, purpose) values ('Tagesgeld', ${iban}, 'geschaeft')`;
    const drei = (await vorschlaege()).find((r) => r.purpose === "Umbuchung drei");
    expect(drei?.bestaetigung).toBeNull();
    await expect(bestaetigen.bestaetigeVorschlaege(actor, [await idVon("Umbuchung drei")])).rejects.toThrow(/nichts gebucht/);
  });
});
