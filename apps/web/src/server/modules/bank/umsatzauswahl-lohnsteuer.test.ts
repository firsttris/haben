import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Lohnsteuer in der Liste (#1440): Eine Lastschrift des Finanzamts über genau den Betrag einer Lohnsteuer-Anmeldung zeigt
 * wie in der Detailansicht „Vorschlag“. Bestätigen lässt sie sich nicht: Sie hat kein Markierfeld.
 */

vi.mock("../lohn/index.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lohn/index.ts")>()),
  lstaZahlbetraege: vi.fn(async () => [{ key: "2026-10", label: "10/2026", betrag: 1_234_56 }]),
}));

function dkbCsv(rows: [date: string, name: string, purpose: string, amount: string][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows
    .map(([date, name, purpose, amount]) =>
      [date, date, "Gebucht", "Testfirma", name, purpose, "Ausgang", "", amount, "", "", ""].map((c) => `"${c}"`).join(";"),
    )
    .join("\n");
  return { bytes: new TextEncoder().encode(`﻿${header}${columns}${body}\n`), filename: "auszug.csv" };
}

describe.skipIf(!testDatabaseUrl)("Lohnsteuer in der Umsatzliste (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function hinweise() {
    const konten = await bank.listAccounts();
    const rows = await bank.listTransactions(
      konten.map((k) => k.id),
      "offen",
      "",
    );
    const { mitHinweisen } = await import("./umsatzauswahl.ts");
    return mitHinweisen(rows, await bank.openItems(), await bank.ownAccounts(), konten);
  }

  it("zeigt „Vorschlag“ ohne Bestätigung, nur beim Betrag der Anmeldung und beim Finanzamt", async () => {
    await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform,
                                   kleinunternehmer, datev_berater_nr, datev_mandant_nr)
      values (1, 'Testfirma', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB',
              'SKR03', 'soll', 'gmbh', false, '29098', '55003')`;
    await bank.importStatement(
      actor,
      dkbCsv([
        ["13.10.26", "Finanzamt Bremen", "Lohnsteuer 10/2026", "-1.234,56"],
        ["14.10.26", "Finanzamt Bremen", "Anderer Betrag", "-500,00"],
        ["15.10.26", "Musterlieferant GmbH", "Gleicher Betrag, kein Finanzamt", "-1.234,56"],
      ]),
      null,
    );
    const rows = await hinweise();
    const je = (purpose: string) => rows.find((r) => r.purpose === purpose);
    expect(je("Lohnsteuer 10/2026")).toMatchObject({ hint: "vorschlag", bestaetigung: null });
    expect(je("Anderer Betrag")?.hint).toBe("belegFehlt");
    expect(je("Gleicher Betrag, kein Finanzamt")?.hint).toBe("belegFehlt");
  });
});
