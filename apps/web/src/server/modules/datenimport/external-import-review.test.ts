import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const renderer = vi.hoisted(() => ({ pause: null as (() => Promise<void>) | null }));
vi.mock("@haben/einvoice", async (original) => ({
  ...(await original<typeof import("@haben/einvoice")>()),
  // Nur das Zeitfenster der PDF-Erzeugung steuern; Buchungen, Nummernvergabe und Sperren bleiben echt.
  buildEInvoice: async () => {
    await renderer.pause?.();
    return { pdf: new TextEncoder().encode("%PDF-1.4\n%%EOF"), xml: "<Invoice/>" };
  },
}));

describe.skipIf(!testDatabaseUrl)("Belegimport: unabhängiges TDD-Review (Postgres)", () => {
  let sql: postgres.Sql;
  let imports: typeof import("./external-import.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let database: typeof import("../../db/index.ts");
  const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj <</Type/Catalog>> endobj\n%%EOF");
  const hash = createHash("sha256").update(pdf).digest("hex");
  const buyer = { name: "Erfundener Kunde", strasse: "Musterweg 1", plz: "10115", ort: "Berlin", land: "DE" };
  const invoice = () => ({
    kind: "invoice" as const,
    externalId: "original-1",
    number: "ALT-10042",
    date: "2024-01-03",
    dueDate: "2024-01-17",
    contactId: null,
    buyer,
    gross: 100000,
    settledAmount: 40000,
    lines: [{ description: "Erfundene Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 100000 }],
    pdfSha256: hash,
  });
  const run = (entries: Parameters<typeof imports.runExternalImport>[1]["entries"]) =>
    imports.runExternalImport("review-user", { version: 1, source: "review-originale", kontenrahmen: "SKR03", entries }, async () => pdf);

  beforeAll(async () => {
    sql = await setupTestDb();
    imports = await import("./external-import.ts");
    invoices = await import("../rechnungen/index.ts");
    reports = await import("../auswertungen/index.ts");
    database = await import("../../db/index.ts");
  }, 30_000);
  afterAll(async () => {
    await database?.closeDatabase();
    await sql?.end();
  });
  beforeEach(async () => {
    renderer.pause = null;
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`truncate seals, company, contacts, quotes, invoices, journal_entries, external_imports, invoice_number_counters, quote_number_counters cascade`;
    });
    await sql`insert into company (id,name,strasse,plz,ort,email,steuernummer,bundesland,iban,kleinunternehmer,rechtsform,kontenrahmen,invoice_number_format)
      values (1,'Erfundener Testbetrieb','Musterstraße 1','93047','Regensburg','review@example.com','198/113/10010','BY','DE89370400440532013000',true,'einzelunternehmen','SKR03','RE-{JJJJ}-{NNNN}')`;
  });

  it("erhält die EÜR-Zahlungsnachweise eines übernommenen Vorjahres im Jahresarchiv", async () => {
    const evidence = "review-zahlungsnachweis-auszug-2024-zeile-42";
    await run([
      invoice(),
      {
        kind: "journal",
        externalId: "zahlung-1",
        date: "2024-01-05",
        description: "Erfundene ursprüngliche Zahlung",
        lines: [
          { account: "1200", debit: 40000, credit: 0 },
          { account: "1400", debit: 0, credit: 40000 },
        ],
        cashFlows: [{ date: "2024-01-05", amount: 40000, category: "einnahme", evidence }],
      },
    ]);
    expect((await reports.euerForYear(2024)).totalEinnahmen).toBe(40000);
    const { exportYear } = await import("../archiv/export.ts");
    const chunks: Uint8Array[] = [];
    for await (const chunk of exportYear(2024)) chunks.push(chunk);
    const files = unzipSync(Buffer.concat(chunks));
    const filesWithEvidence = Object.entries(files)
      .filter(([, bytes]) => new TextDecoder().decode(bytes).includes(evidence))
      .map(([path]) => path);
    expect(filesWithEvidence, "Der Nachweis der EÜR-Einnahme von 400,00 EUR muss im Jahresarchiv erhalten bleiben").not.toHaveLength(0);
  });

  it("schützt auch eine in Haben ausgestellte API-Rechnung mit externer Referenz vor einem gleichzeitigen Originalimport", async () => {
    const [contact] = await sql`insert into contacts (name,strasse,plz,ort,land,email)
      values ('Erfundener API-Kunde','Musterweg 1','10115','Berlin','DE','kunde@example.com') returning id`;
    const draft = await invoices.createDraft(
      "review-user",
      {
        contactId: contact!.id as string,
        issueDate: "2026-01-03",
        serviceFrom: null,
        serviceTo: null,
        paymentTermDays: 14,
        format: "zugferd",
        note: "",
        taxTreatment: "kleinunternehmer",
        lines: [{ description: "API-Bestellung", quantity: 1000, unit: "Psch.", unitPrice: 100000, taxRate: 0 }],
      },
      { externalSource: "etsy", externalId: "bestellung-42" },
    );
    const started = Promise.withResolvers<void>();
    const proceed = Promise.withResolvers<void>();
    renderer.pause = async () => {
      started.resolve();
      await proceed.promise;
    };
    const finalizing = invoices.finalizeInvoice("review-user", draft.id);
    const observed = finalizing.then(
      () => null,
      (error: unknown) => error,
    );
    await Promise.race([
      started.promise,
      observed.then((error) => {
        throw error ?? new Error("PDF-Zeitfenster fehlt");
      }),
    ]);
    try {
      await run([{ ...invoice(), number: "RE-2026-0001", date: "2026-01-03", dueDate: "2026-01-17" }]);
    } finally {
      proceed.resolve();
    }
    await observed;
    const originals = await sql`select id from invoices where status='final' and number='RE-2026-0001'`;
    expect(originals).toHaveLength(1);
  });
});
