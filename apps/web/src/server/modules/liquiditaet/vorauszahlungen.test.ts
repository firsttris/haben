import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";
import { ACTOR, dkbCsv, firma, kunde } from "./test-liquiditaet.ts";

/*
 * Vorauszahlungen in der Liquiditätsvorschau (#1381) gegen Postgres: die letzte zugeordnete Zahlung je Steuerart
 * fortgeschrieben, Nachzahlungen für frühere Jahre und aufgehobene Zuordnungen zählen nicht; ohne Zahlung ein Viertel der
 * Prognose. Einzelunternehmen (ESt privat, SKR03/Ist und SKR04/Soll) und GmbH (KSt, GewSt).
 */

const PERSON = { veranlagung: "einzel", a: { vorname: "Max", name: "Muster", religion: "11" } };

describe.skipIf(!testDatabaseUrl)("Liquiditätsvorschau: Vorauszahlungen (Postgres)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("../bank/index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let finanzamt: typeof import("../finanzamt/index.ts");
  let vorauszahlungen: typeof import("./vorauszahlungen.ts");
  let kontext: typeof import("./kontext.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    finanzamt = await import("../finanzamt/index.ts");
    vorauszahlungen = await import("./vorauszahlungen.ts");
    kontext = await import("./kontext.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  type Art = "est" | "soli" | "kist" | "kst" | "gewst";

  /** Zahlungen ans Finanzamt importieren und als Steuer zuordnen: [Datum, Betrag in Cent, Steuerart, Bezugsjahr] */
  async function zahlungen(liste: [datum: string, betrag: number, art: Art, jahr: number][]) {
    const euro = (cent: number) => `-${(cent / 100).toFixed(2).replace(".", ",")}`;
    await bank.importStatement(ACTOR, dkbCsv(liste.map(([datum, betrag, art, jahr]) => [datum, "Finanzamt Regensburg", `${art} ${jahr}`, euro(betrag)])), null);
    for (const [, betrag, art, jahr] of liste) {
      const [tx] = await sql<{ id: string }[]>`select id from bank_transactions where purpose = ${`${art} ${jahr}`} and amount = ${-betrag}`;
      await bank.allocate(ACTOR, { kind: "steuer", transactionId: tx!.id, amount: -betrag, steuer: { art, jahr, posten: "steuer" } });
    }
  }

  const kurz = (posten: Awaited<ReturnType<typeof vorauszahlungen.vorauszahlungPosten>>) =>
    posten.map((p) => [p.datum, p.betrag, p.sicherheit, p.privat ?? false, p.text]);

  it("Einzelunternehmen (SKR03, Ist): letzte Zahlung je Steuerart fortgeschrieben, ESt privat, GewSt nicht", async () => {
    await firma(sql, { kontenrahmen: "SKR03", versteuerung: "ist", taxpayer: PERSON });
    await zahlungen([
      ["10.06.26", 100_000, "est", 2026],
      ["10.09.26", 120_000, "est", 2026],
      ["10.09.26", 6_600, "soli", 2026],
      ["17.08.26", 50_000, "gewst", 2026],
      // Nachzahlung aus dem Bescheid für 2024: keine Vorauszahlung
      ["01.10.26", 300_000, "est", 2024],
      // Zugeordnet und wieder aufgehoben
      ["05.11.26", 5_000, "kist", 2026],
    ]);
    const [kist] = await sql<{ id: string }[]>`select id from allocations where tax_type = 'kist'`;
    await bank.reverseAllocation(ACTOR, kist!.id, "2026-11-06");

    const posten = await vorauszahlungen.vorauszahlungPosten(await kontext.ladeKontext("2026-11-20", "6m"));
    expect(kurz(posten)).toEqual([
      ["2026-12-10", 120_000, "erwartet", true, "Einkommensteuer, wie zuletzt gezahlt"],
      ["2027-03-10", 120_000, "erwartet", true, "Einkommensteuer, wie zuletzt gezahlt"],
      // 15.11.2026 (Sonntag, also 16.11.) liegt vor heute und ist nicht gezahlt: Stufe 1 schreibt nur künftige Termine fort.
      // 15.05.2027 ist ein Samstag, der Montag danach Pfingstmontag
      ["2027-02-15", 50_000, "erwartet", false, "Gewerbesteuer, wie zuletzt gezahlt"],
      ["2027-05-18", 50_000, "erwartet", false, "Gewerbesteuer, wie zuletzt gezahlt"],
      ["2026-12-10", 6_600, "erwartet", true, "Solidaritätszuschlag, wie zuletzt gezahlt"],
      ["2027-03-10", 6_600, "erwartet", true, "Solidaritätszuschlag, wie zuletzt gezahlt"],
    ]);
    const [est] = await sql<{ transaction_id: string }[]>`select transaction_id from allocations where tax_type = 'est' and tax_year = 2026 order by created_at desc limit 1`;
    expect(posten[0]?.quelle).toEqual({ art: "vorauszahlung", id: est!.transaction_id });
  }, 30_000);

  it("Einzelunternehmen ohne Zahlung (SKR04, Soll): ein Viertel der Prognose, geschätzt; ohne festgesetzte Vorauszahlungen keine", async () => {
    await firma(sql, { kontenrahmen: "SKR04", versteuerung: "soll", taxpayer: PERSON });
    const contactId = await kunde(contacts);
    const draft = await invoices.createDraft(ACTOR, {
      contactId,
      issueDate: "2026-07-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Projekt", quantity: 1000, unit: "Psch.", unitPrice: 6_000_000, taxRate: 1900 }],
    });
    const projekt = await invoices.finalizeInvoice(ACTOR, draft.id, kleinunternehmerStand);
    // Die EÜR rechnet nach Zufluss: erst die Zahlung macht Gewinn
    await bank.importStatement(ACTOR, dkbCsv([["15.07.26", "Nordwerk", "Projekt", "71.400,00"]]), null);
    const [tx] = await sql<{ id: string }[]>`select id from bank_transactions`;
    await bank.allocate(ACTOR, { kind: "invoice", transactionId: tx!.id, invoiceId: projekt.id, amount: 7_140_000 });

    const viertel = (await finanzamt.prepaymentBasis("2026-11-20")).prognose.jeQuartal;
    expect(viertel).toBeGreaterThan(0);
    const posten = await vorauszahlungen.vorauszahlungPosten(await kontext.ladeKontext("2026-11-20", "6m"));
    expect(kurz(posten)).toEqual([
      ["2026-12-10", viertel, "geschaetzt", true, "Einkommensteuer, ein Viertel der Prognose"],
      ["2027-03-10", viertel, "geschaetzt", true, "Einkommensteuer, ein Viertel der Prognose"],
    ]);
    expect(posten[0]?.quelle).toEqual({ art: "vorauszahlung", id: "2026" });

    await sql`update company set taxpayer = ${JSON.stringify({ ...PERSON, keineVorauszahlungen: true })}::jsonb`;
    expect(await vorauszahlungen.vorauszahlungPosten(await kontext.ladeKontext("2026-11-20", "6m"))).toEqual([]);
  }, 30_000);

  it("GmbH (SKR04, Soll): Körperschaft- und Gewerbesteuer fortgeschrieben, nicht privat, ohne Prognose", async () => {
    await firma(sql, { rechtsform: "gmbh", kontenrahmen: "SKR04", versteuerung: "soll" });
    await zahlungen([
      ["10.09.26", 200_000, "kst", 2026],
      ["10.09.26", 11_000, "soli", 2026],
      ["17.08.26", 80_000, "gewst", 2026],
    ]);
    const posten = await vorauszahlungen.vorauszahlungPosten(await kontext.ladeKontext("2026-11-20", "13w"));
    expect(kurz(posten)).toEqual([
      ["2027-02-15", 80_000, "erwartet", false, "Gewerbesteuer, wie zuletzt gezahlt"],
      ["2026-12-10", 200_000, "erwartet", false, "Körperschaftsteuer, wie zuletzt gezahlt"],
      ["2026-12-10", 11_000, "erwartet", false, "Solidaritätszuschlag, wie zuletzt gezahlt"],
    ]);
  }, 30_000);
});
