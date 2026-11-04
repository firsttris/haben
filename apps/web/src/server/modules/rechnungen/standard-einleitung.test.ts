import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Standard-Einleitung für Rechnungen und Angebote (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./invoices.ts");
  let quotes: typeof import("./quotes.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    quotes = await import("./quotes.ts");
    stammdaten = await import("../stammdaten/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate invoice_lines, invoices, quote_lines, quotes, company cascade`;
  });

  const lines = [{ description: "Beratung", quantity: 1000, unit: "Std." as const, unitPrice: 10_000, taxRate: 1900 as const }];

  /** Firmendaten wie aus dem Formular der Einstellungen speichern */
  async function saveIntros(invoiceIntro: string, quoteIntro: string) {
    const current = stammdaten.companySchema.parse(await stammdaten.loadCompany());
    await stammdaten.saveCompany(actor, stammdaten.companySchema.parse({ ...current, invoiceIntro, quoteIntro }), "2026-11-04");
  }

  it("ohne Vorgabe beginnen Rechnung und Angebot ohne Einleitung", async () => {
    expect((await invoices.newDraftDefaults("2026-11-04")).intro).toBe("");
    expect((await quotes.newQuoteDefaults("2026-11-04")).intro).toBe("");
  });

  it("belegt neue Rechnungen und Angebote mit ihrer eigenen Einleitung vor", async () => {
    await saveIntros("  Für die erbrachten Leistungen berechne ich Ihnen:\n", "Gerne biete ich Ihnen an:");
    expect((await invoices.newDraftDefaults("2026-11-04")).intro).toBe("Für die erbrachten Leistungen berechne ich Ihnen:");
    expect((await quotes.newQuoteDefaults("2026-11-04")).intro).toBe("Gerne biete ich Ihnen an:");
  });

  it("die Einleitung bleibt im Beleg änderbar, und spätere Änderungen der Vorgabe ändern keinen Entwurf", async () => {
    await saveIntros("Vorgabe Rechnung", "Vorgabe Angebot");
    const invoice = await invoices.createDraft(actor, { ...(await invoices.newDraftDefaults("2026-11-04")), intro: "Bestellnummer 4711", lines });
    const quote = await quotes.createQuoteDraft(actor, { ...(await quotes.newQuoteDefaults("2026-11-04")), lines });
    await saveIntros("Neue Vorgabe", "");
    expect((await invoices.getInvoice(invoice.id))?.invoice.intro).toBe("Bestellnummer 4711");
    expect((await quotes.getQuote(quote.id))?.quote.intro).toBe("Vorgabe Angebot");
    expect((await quotes.newQuoteDefaults("2026-11-04")).intro).toBe("");
  });

  it("nimmt höchstens 2000 Zeichen an, so viel wie das Feld im Beleg", async () => {
    const current = stammdaten.companySchema.parse(await stammdaten.loadCompany());
    expect(stammdaten.companySchema.safeParse({ ...current, invoiceIntro: "x".repeat(2000) }).success).toBe(true);
    expect(stammdaten.companySchema.safeParse({ ...current, quoteIntro: "x".repeat(2001) }).success).toBe(false);
  });
});
