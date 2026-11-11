import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Rechnungen nach Rechnungsdatum (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./invoices.ts");
  let database: typeof import("../../db/index.ts");
  const finals: string[] = [];
  let newestDraft: string;
  let oldestDraft: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    database = await import("../../db/index.ts");
    invoices = await import("./invoices.ts");
    const contacts = await import("../stammdaten/contacts.ts");
    await sql`insert into company(id,name,strasse,plz,ort,email,steuernummer,bundesland,kleinunternehmer,iban)
      values(1,'Erfundener Testbetrieb','Musterweg 1','12345','Musterstadt','test@example.com','123/456/78901','NI',true,'DE89370400440532013000')`;
    const contact = await contacts.createContact("test-user", {
      kundennummer: "10001",
      name: "Erfundener Kunde",
      strasse: "Testweg 2",
      plz: "12345",
      ort: "Musterstadt",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    async function draft(date: string) {
      return invoices.createDraft("test-user", {
        ...(await invoices.newDraftDefaults(date)),
        contactId: contact.id,
        lines: [{ description: "Erfundene Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10000, taxRate: 0 }],
      });
    }
    const cases = [
      ["2024-12-12", "ZZZ-{NNN}", "2026-11-11T20:10:00Z"],
      ["2025-02-01", "99990-{NNN}", "2026-11-11T20:09:00Z"],
      ["2026-01-01", "70000-{NNN}", "2026-11-11T20:08:00Z"],
      ["2026-06-01", "50000-{NNN}", "2026-11-11T20:07:00Z"],
      ["2026-10-01", "30000-{NNN}", "2026-11-11T20:06:00Z"],
      ["2026-11-08", "10100-{NNN}", "2026-11-11T20:04:00Z"],
      ["2026-11-08", "00100-{NNN}", "2026-11-11T20:05:00Z"],
    ];
    for (const [date, format, createdAt] of cases) {
      await sql`update company set invoice_number_format=${format!}`;
      const created = await draft(date!);
      await sql`update invoices set created_at=${createdAt!} where id=${created.id}`;
      finals.push((await invoices.finalizeInvoice("test-user", created.id)).id);
    }
    newestDraft = (await draft("2026-11-11")).id;
    oldestDraft = (await draft("2023-01-01")).id;
  }, 60_000);

  afterAll(async () => {
    await database?.closeDatabase();
    await sql?.end();
  });

  const expectedFinals = () => [finals[5], finals[6], finals[4], finals[3], finals[2], finals[1], finals[0]];

  it("ordnet nach Datum und bei gleichem Datum nach Nummer, unabhängig vom Importzeitpunkt", async () => {
    const rows = await invoices.listInvoices("2026-11-11");
    expect(rows.map((i) => i.id)).toEqual([newestDraft, ...expectedFinals(), oldestDraft]);
    expect((await invoices.listInvoices("2026-11-11")).map((i) => i.id)).toEqual(rows.map((i) => i.id));
  });

  it("zeigt in der Übersicht die fünf jüngsten festgeschriebenen Rechnungen", async () => {
    const summary = await invoices.invoiceSummary("2026-11-11");
    expect(summary.recent.map((i) => i.id)).toEqual(expectedFinals().slice(0, 5));
    expect(summary.drafts).toBe(2);
    expect(summary.openTotal).toBe(70000);
    expect(summary.recent.every((i) => i.status === "final")).toBe(true);
  });
});
