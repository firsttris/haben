import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { nachStatusSortieren, type UmsatzHinweis } from "./umsatzliste.ts";

/*
 * Sortierung der Umsatzliste im Bankabgleich (#681): Datum, Gegenpartei und Betrag sortiert die Datenbank vor der
 * Grenze von 500 Umsätzen, den Status sortiert die Liste nach dem Laden. Ohne Sortierung der neueste Umsatz oben.
 * Keine Buchung, deshalb ohne Kontenrahmen und Versteuerung.
 */

describe("nachStatusSortieren", () => {
  const liste = (hints: UmsatzHinweis[]) => hints.map((hint, i) => ({ hint, nr: i }));
  const alle: UmsatzHinweis[] = ["zugeordnet", "offen", "verrechnet", "belegFehlt", "teilweise", "vorschlag", "belegFehlt"];

  it("absteigend (erster Klick): oben steht, was zu tun ist, bei gleichem Status die bisherige Reihenfolge", () => {
    expect(nachStatusSortieren(liste(alle), "ab").map((u) => `${u.hint}${u.nr}`)).toEqual([
      "belegFehlt3",
      "belegFehlt6",
      "vorschlag5",
      "offen1",
      "teilweise4",
      "zugeordnet0",
      "verrechnet2",
    ]);
  });

  it("aufsteigend: erst das Erledigte, bei gleichem Status weiter die bisherige Reihenfolge", () => {
    expect(nachStatusSortieren(liste(alle), "auf").map((u) => `${u.hint}${u.nr}`)).toEqual([
      "verrechnet2",
      "zugeordnet0",
      "teilweise4",
      "offen1",
      "vorschlag5",
      "belegFehlt3",
      "belegFehlt6",
    ]);
  });
});

const GIRO = "DE12 1203 0000 1234 5678 90";

function dkbCsv(rows: [date: string, name: string, amount: string][]) {
  const header = `"Girokonto";"${GIRO}"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows
    .map(([date, name, amount]) => {
      const ausgang = amount.startsWith("-");
      return [
        date,
        date,
        "Gebucht",
        ausgang ? "Nordlicht" : name,
        ausgang ? name : "Nordlicht",
        `Umsatz ${date}`,
        ausgang ? "Ausgang" : "Eingang",
        "",
        amount,
        "",
        "",
        "",
      ]
        .map((c) => `"${c}"`)
        .join(";");
    })
    .join("\n");
  return { bytes: new TextEncoder().encode(`﻿${header}${columns}${body}\n`), filename: "auszug.csv" };
}

describe.skipIf(!testDatabaseUrl)("Umsatzliste sortieren (Postgres, #681)", () => {
  let bank: typeof import("./index.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate bank_neutralizations, allocations, bank_transactions, bank_imports, bank_accounts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung)
      values (1, 'Nordlicht Software', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'ist')`;
    await bank.importStatement(
      "test-user",
      dkbCsv([
        ["02.01.24", "Altkunde GmbH", "9.999,00"],
        ["10.10.26", "beta Werkstatt", "-120,00"],
        ["11.10.26", "Zeta Druck", "-5,00"],
        ["12.10.26", "", "40,00"],
      ]),
      null,
    );
  });

  const kontoId = async () => (await sql<{ id: string }[]>`select id from bank_accounts where iban = ${GIRO.replace(/\s/g, "")}`)[0]!.id;
  const liste = async (feld: "datum" | "gegenpartei" | "betrag" | "status", richtung: "auf" | "ab") =>
    (await bank.listTransactions(await kontoId(), "alle", "", { feld, richtung })).map((t) => `${t.bookingDate} ${t.counterpartyName} ${t.amount}`);

  it("ohne Sortierung wie bisher: neuester Umsatz oben", async () => {
    const ohne = (await bank.listTransactions(await kontoId(), "alle", "")).map((t) => t.bookingDate);
    expect(ohne).toEqual(["2026-10-12", "2026-10-11", "2026-10-10", "2024-01-02"]);
  });

  it("nach Datum in beide Richtungen", async () => {
    expect(await liste("datum", "auf")).toEqual([
      "2024-01-02 Altkunde GmbH 999900",
      "2026-10-10 beta Werkstatt -12000",
      "2026-10-11 Zeta Druck -500",
      "2026-10-12  4000",
    ]);
    expect((await liste("datum", "ab"))[0]).toBe("2026-10-12  4000");
  });

  it("nach Betrag in beide Richtungen, mit Vorzeichen", async () => {
    expect(await liste("betrag", "ab")).toEqual([
      "2024-01-02 Altkunde GmbH 999900",
      "2026-10-12  4000",
      "2026-10-11 Zeta Druck -500",
      "2026-10-10 beta Werkstatt -12000",
    ]);
    expect((await liste("betrag", "auf"))[0]).toBe("2026-10-10 beta Werkstatt -12000");
  });

  it("nach Gegenpartei ohne Rücksicht auf Groß- und Kleinschreibung, ohne Namen in beiden Richtungen unten", async () => {
    expect(await liste("gegenpartei", "auf")).toEqual([
      "2024-01-02 Altkunde GmbH 999900",
      "2026-10-10 beta Werkstatt -12000",
      "2026-10-11 Zeta Druck -500",
      "2026-10-12  4000",
    ]);
    expect(await liste("gegenpartei", "ab")).toEqual([
      "2026-10-11 Zeta Druck -500",
      "2026-10-10 beta Werkstatt -12000",
      "2024-01-02 Altkunde GmbH 999900",
      "2026-10-12  4000",
    ]);
  });

  it("nach Status: die Datenbank liefert die neuesten zuerst, sortiert wird nach dem Laden", async () => {
    expect((await liste("status", "ab")).map((z) => z.slice(0, 10))).toEqual(["2026-10-12", "2026-10-11", "2026-10-10", "2024-01-02"]);
  });

  it("mit mehr als 500 Umsätzen sortiert die Datenbank vor der Grenze: der größte und der älteste Umsatz stehen oben", async () => {
    await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, purpose, dedup_hash)
      select bank_account_id, import_id, '2026-10-20', 100, 'Masse', 'Verkauf', 'masse-' || g
      from bank_transactions, generate_series(1, 500) g where amount = 999900`;
    const ohne = await bank.listTransactions(await kontoId(), "alle", "");
    expect(ohne).toHaveLength(500);
    expect(ohne.some((t) => t.amount === 999900)).toBe(false);

    expect((await liste("betrag", "ab"))[0]).toBe("2024-01-02 Altkunde GmbH 999900");
    expect((await liste("betrag", "auf")).slice(0, 2)).toEqual(["2026-10-10 beta Werkstatt -12000", "2026-10-11 Zeta Druck -500"]);
    expect((await liste("datum", "auf"))[0]).toBe("2024-01-02 Altkunde GmbH 999900");
    expect((await liste("gegenpartei", "auf"))[0]).toBe("2024-01-02 Altkunde GmbH 999900");
  });
});
