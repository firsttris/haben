import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Firmenlogo (Postgres)", () => {
  let logo: typeof import("./logo.ts");
  let quotes: typeof import("./quotes.ts");
  let contacts: typeof import("./contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const png = new Uint8Array(readFileSync(new URL("../../public/icon-192.png", import.meta.url)));
  const pdfText = (pdf: Uint8Array | Buffer | null | undefined) => Buffer.from(pdf!).toString("latin1");

  beforeAll(async () => {
    sql = await setupTestDb();
    logo = await import("./logo.ts");
    quotes = await import("./quotes.ts");
    contacts = await import("./contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate company_logo, quote_lines, quotes, quote_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, iban)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', 'DE89370400440532013000')`;
  });

  it("speichert PNG, lehnt anderes ab und hält Binärdaten aus dem Protokoll", async () => {
    expect(await logo.loadLogo()).toBeUndefined();
    await expect(logo.saveLogo(actor, new TextEncoder().encode("GIF89a……"))).rejects.toThrow(/PNG und JPEG/);
    await expect(logo.saveLogo(actor, new Uint8Array(logo.MAX_LOGO_BYTES + 1))).rejects.toThrow(/1 MB/);
    await logo.saveLogo(actor, png);
    await logo.saveLogo(actor, png);
    expect((await logo.loadLogo())?.format).toBe("png");
    expect((await logo.logoInfo())?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const log = await sql`select action, new_value from audit_log where table_name = 'company_logo' order by id`;
    expect(log.map((r) => r.action)).toEqual(["INSERT", "UPDATE"]);
    expect(log[0]!.new_value).not.toHaveProperty("logo");
    expect(log[0]!.new_value).toHaveProperty("sha256");
    await logo.removeLogo(actor);
    expect(await logo.logoInfo()).toBeNull();
  });

  it("druckt das Logo in neu festgeschriebene Angebote", async () => {
    const contact = await contacts.createContact(actor, {
      kundennummer: "", name: "Nordwerk GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
      email: "", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
    });
    const draft = () =>
      quotes.createQuoteDraft(actor, {
        contactId: contact.id, issueDate: "2026-10-01", validUntil: "2026-10-31", serviceFrom: null, serviceTo: null, note: "",
        lines: [{ description: "Beratung", quantity: 1000, unit: "Std.", unitPrice: 10_000, taxRate: 1900 }],
      });
    const ohne = await quotes.finalizeQuote(actor, (await draft()).id);
    await logo.saveLogo(actor, png);
    const mit = await quotes.finalizeQuote(actor, (await draft()).id);
    expect(pdfText(ohne.pdf)).not.toContain("/Subtype /Image");
    expect(pdfText(mit.pdf)).toContain("/Subtype /Image");
  });
});
