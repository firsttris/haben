import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const renderer = vi.hoisted(() => ({ pause: null as (() => Promise<void>) | null }));
vi.mock("@haben/einvoice", async (original) => ({
  ...(await original<typeof import("@haben/einvoice")>()),
  buildEInvoice: async () => {
    await renderer.pause?.();
    return { pdf: new TextEncoder().encode("%PDF-1.4\n%%EOF"), xml: "<Invoice/>" };
  },
}));

describe.skipIf(!testDatabaseUrl)("Belegimport: Regressionen aus der ersten Reviewrunde (Postgres)", () => {
  let sql: postgres.Sql;
  let imports: typeof import("./external-import.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let archive: typeof import("../archiv/index.ts");
  let database: typeof import("../../db/index.ts");
  const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj <</Type/Catalog>> endobj\n%%EOF");
  const hash = createHash("sha256").update(pdf).digest("hex");
  const invoice = () => ({
    kind: "invoice" as const,
    type: "invoice" as const,
    direction: "einnahme" as const,
    externalId: "original-1",
    number: "ALT-10042",
    date: "2024-01-03",
    dueDate: "2024-01-17",
    contactId: null,
    contactName: "Erfundener Kunde",
    currency: "EUR" as const,
    net: 100000,
    tax: 0,
    gross: 100000,
    status: "open" as const,
    taxes: [{ rate: 0, net: 100000, tax: 0 }],
    taxType: "vatfree",
    payment: null,
    pdfSha256: hash,
  });
  const run = (entries: Parameters<typeof imports.runExternalImport>[1]["entries"]) =>
    imports.runExternalImport("review-user", { version: 2, source: "review-originale", kontenrahmen: "SKR03", entries }, async () => pdf);
  beforeAll(async () => {
    sql = await setupTestDb();
    imports = await import("./external-import.ts");
    invoices = await import("../rechnungen/index.ts");
    archive = await import("../archiv/index.ts");
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
      await tx`truncate seals, company, contacts, quotes, invoices, journal_entries, external_imports, lexoffice_imports, invoice_number_counters, quote_number_counters cascade`;
    });
    await sql`insert into company (id,name,strasse,plz,ort,email,steuernummer,bundesland,iban,kleinunternehmer,rechtsform,kontenrahmen,invoice_number_format)
      values (1,'Erfundener Testbetrieb','Musterstraße 1','93047','Regensburg','review@example.com','198/113/10010','BY','DE89370400440532013000',true,'einzelunternehmen','SKR03','RE-{JJJJ}-{NNNN}')`;
  });

  it("erhält Zahlungsnachweise und Herkunft eines übernommenen Vorjahres im Jahresarchiv", async () => {
    const evidence = "review-zahlungsnachweis-auszug-2024-zeile-42";
    await run([
      { ...invoice(), status: "partlyPaid", payment: { openAmount: 60000, paidDate: null, items: [{ date: "2024-01-05", amount: 40000, evidence }] } },
      {
        kind: "journal",
        externalId: "zahlung-1",
        date: "2024-01-05",
        description: "Erfundene ursprüngliche Zahlung",
        lines: [
          { account: "1200", debit: 40000, credit: 0 },
          { account: "1400", debit: 0, credit: 40000 },
        ],
      },
    ]);
    const chunks: Uint8Array[] = [];
    for await (const chunk of archive.exportYear(2024)) chunks.push(chunk);
    const files = unzipSync(Buffer.concat(chunks));
    expect(Object.values(files).some((bytes) => new TextDecoder().decode(bytes).includes(evidence))).toBe(true);
    expect(files["importe/uebernahmen.json"]).toBeDefined();
    expect(Object.keys(files).filter((p) => p.endsWith(".pdf"))).toHaveLength(1);
  });

  it("schützt die native API-Nummer auch während eines parallelen Umzugs und benennt den Übernahmekonflikt", async () => {
    const [contact] =
      await sql`insert into contacts (name,strasse,plz,ort,land,email) values ('Erfundener API-Kunde','Musterweg 1','10115','Berlin','DE','kunde@example.com') returning id`;
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
    let reached!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    renderer.pause = async () => {
      reached();
      await proceed;
    };
    const finalizing = invoices.finalizeInvoice("review-user", draft.id);
    const observed = finalizing.then(
      () => null,
      (error: unknown) => error,
    );
    await Promise.race([
      started,
      observed.then((error) => {
        throw error ?? new Error("PDF-Zeitfenster fehlt");
      }),
    ]);
    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await run([{ ...invoice(), number: "RE-2026-0001", date: "2026-01-03", dueDate: "2026-01-17" }]);
    } finally {
      resume();
    }
    expect(await observed).toBeNull();
    expect(await sql`select id from invoices where status='final' and number='RE-2026-0001'`).toHaveLength(1);
    await expect(archive.takeOverLegacyItem("review-user", result.items[0]!.id, "2026-01-31")).rejects.toThrow("Rechnungsnummer");
    expect(await sql`select id from lexoffice_vouchers where number='RE-2026-0001'`).toHaveLength(1);
  });
});
