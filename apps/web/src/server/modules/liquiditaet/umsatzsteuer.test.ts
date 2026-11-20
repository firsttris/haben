import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";
import { ACTOR, dkbCsv, firma, kunde } from "./test-liquiditaet.ts";

/*
 * Umsatzsteuer der noch nicht abgegebenen Zeiträume in der Liquiditätsvorschau (#1381) gegen Postgres: gebucht plus die
 * Steuer der erwarteten Posten. Bei Ist kommt die Steuer der offenen Rechnung aus dem Posten, bei Soll ist sie schon
 * gebucht; beide Wege ergeben dieselbe Zahllast. Monatlich mit Dauerfrist und Sondervorauszahlung (SKR03, Ist),
 * vierteljährlich ohne (SKR04, Soll).
 */

describe.skipIf(!testDatabaseUrl)("Liquiditätsvorschau: Umsatzsteuer (Postgres)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("../bank/index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let vorschau: typeof import("./vorschau.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    vorschau = await import("./vorschau.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function rechnung(contactId: string, net: number, issueDate: string) {
    const draft = await invoices.createDraft(ACTOR, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std." as const, unitPrice: net, taxRate: 1900 as const }],
    });
    return invoices.finalizeInvoice(ACTOR, draft.id, kleinunternehmerStand);
  }

  /** 1.190 € am 10.11. bezahlt, 2.380 € offen und fällig am 30.11. */
  async function rechnungen() {
    const contactId = await kunde(contacts);
    const bezahlt = await rechnung(contactId, 100_000, "2026-11-02");
    await rechnung(contactId, 200_000, "2026-11-16");
    await bank.importStatement(ACTOR, dkbCsv([["10.11.26", "Nordwerk", "Rechnung", "1.190,00"]]), null);
    const [tx] = await sql<{ id: string }[]>`select id from bank_transactions`;
    await bank.allocate(ACTOR, { kind: "invoice", transactionId: tx!.id, invoiceId: bezahlt.id, amount: 119_000 });
  }

  const steuerposten = (bericht: Awaited<ReturnType<typeof vorschau.liquiditaetsvorschau>>) =>
    bericht.vorschau.zeitraeume
      .flatMap((z) => z.posten)
      .filter((p) => p.quelle.art === "umsatzsteuer" || p.quelle.art === "sondervorauszahlung")
      .map((p) => [p.datum, p.richtung, p.betrag, p.sicherheit, p.text]);

  it("monatlich mit Dauerfrist (SKR03, Ist): Zahllast einen Monat später, Sondervorauszahlung im Februar, Anrechnung im Dezember", async () => {
    await firma(sql, { kontenrahmen: "SKR03", versteuerung: "ist" });
    await sql`insert into vat_frequencies (year, from_month, frequency) values (2026, 1, 'monatlich')`;
    await sql`insert into vat_extensions (year, active, sondervorauszahlung) values (2026, true, 110000)`;
    await rechnungen();

    const bericht = await vorschau.liquiditaetsvorschau("2026-11-20", "6m");
    expect(steuerposten(bericht)).toEqual([
      // 190 € gebucht (Zahlung am 10.11.) plus 380 € aus der offenen Rechnung, Eingang am 30.11.; 10.01.2027 ist ein Sonntag
      ["2027-01-11", "aus", 57_000, "geschaetzt", "Umsatzsteuer November 2026"],
      // Dezember: noch nichts gebucht, die Sondervorauszahlung 2026 wird angerechnet (Kz 39)
      ["2027-02-10", "ein", 110_000, "geschaetzt", "Umsatzsteuer Dezember 2026"],
      // Für 2027 noch nicht angemeldet: geschätzt wie 2026
      ["2027-02-10", "aus", 110_000, "geschaetzt", "Sondervorauszahlung 2027"],
    ]);
    // Die offene Rechnung steht selbst als Eingang daneben
    expect(bericht.vorschau.eingaenge).toBe(238_000 + 110_000);
  }, 30_000);

  it("vierteljährlich ohne Dauerfrist (SKR04, Soll): die Steuer ist mit der Rechnung gebucht", async () => {
    await firma(sql, { kontenrahmen: "SKR04", versteuerung: "soll" });
    await sql`insert into vat_frequencies (year, from_month, frequency) values (2026, 1, 'vierteljaehrlich')`;
    await rechnungen();

    const bericht = await vorschau.liquiditaetsvorschau("2026-11-20", "6m");
    expect(steuerposten(bericht)).toEqual([["2027-01-11", "aus", 57_000, "geschaetzt", "Umsatzsteuer 4. Quartal 2026"]]);
  }, 30_000);
});
