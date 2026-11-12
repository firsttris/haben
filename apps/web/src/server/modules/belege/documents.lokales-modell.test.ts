import { execFileSync } from "node:child_process";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { computeInvoiceTotals } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { completion, startTestService, type TestService } from "./test-ki-dienst.ts";

// Anthropic ist zusätzlich eingerichtet, darf aber nie gefragt werden
vi.mock("./extraction-anthropic.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./extraction-anthropic.ts")>()),
  extractWithAnthropic: vi.fn(async () => {
    throw new Error("Anthropic darf im lokalen Betrieb nicht aufgerufen werden");
  }),
}));

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3]);

const ANSWER = {
  lieferant: "Telekom Deutschland GmbH",
  lieferantUstId: "DE123475223",
  empfaenger: null,
  empfaengerUstId: null,
  rechnungsnummer: "MF-2026-09",
  belegdatum: "2026-09-29",
  faelligAm: null,
  waehrung: "EUR",
  istGutschrift: false,
  betraege: [{ steuersatz: "19", netto: "38.57", steuer: "7.33" }],
  brutto: "45.90",
  kategorie: "telefon",
  hinweis: null,
};

const hasPdftoppm = (() => {
  try {
    execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!testDatabaseUrl)("Belege mit selbst betriebenem Modell (Postgres)", () => {
  let documents: typeof import("./documents.ts");
  let anthropic: typeof import("./extraction-anthropic.ts");
  let service: TestService;
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    service = await startTestService(() => ({ body: completion(JSON.stringify(ANSWER)) }));
    Object.assign(process.env, {
      ANTHROPIC_API_KEY: "sk-ant-nie-benutzt",
      EXTRACTION_BASE_URL: service.baseUrl,
      EXTRACTION_MODEL: "qwen2.5vl:7b",
      EXTRACTION_TIMEOUT_SECONDS: "10",
    });
    documents = await import("./documents.ts");
    anthropic = await import("./extraction-anthropic.ts");
  }, 30_000);

  afterAll(async () => {
    await service?.close();
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, company cascade`;
    await sql`insert into company (id, name, kontenrahmen) values (1, 'Testfirma', 'SKR03')`;
    service.requests.length = 0;
    service.reply(() => ({ body: completion(JSON.stringify(ANSWER)) }));
  });

  it("Foto: Felder vom eigenen Dienst, Beleg bleibt zu prüfen, Anthropic unberührt", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 1]), filename: "telekom.jpg" });
    const result = (await documents.getDocument(id))!;
    expect(result.document).toMatchObject({
      extractedBy: "ki",
      extractionStatus: "fertig",
      extractionError: null,
      status: "neu",
      lockedAt: null,
      supplierName: "Telekom Deutschland GmbH",
      invoiceNumber: "MF-2026-09",
      documentDate: "2026-09-29",
      gross: 4590,
    });
    expect(result.amounts.map((a) => [a.taxRate, a.net, a.tax])).toEqual([[1900, 3857, 733]]);
    expect(service.requests).toHaveLength(1);
    expect(service.requests[0]!.body.model).toBe("qwen2.5vl:7b");
    expect(anthropic.extractWithAnthropic).not.toHaveBeenCalled();
    expect(await sql`select 1 from journal_entries`).toHaveLength(0);
  });

  it("fehlerhafte Antwort: Fehler am Beleg, keine Beträge, nichts gebucht, kein Ausweichen auf Anthropic", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    service.reply(() => ({ body: completion('{"lieferant": 42}') }));
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 2]), filename: "kaputt.jpg" });
    const result = (await documents.getDocument(id))!;
    expect(result.document).toMatchObject({ extractionStatus: "fehler", status: "neu", lockedAt: null, gross: 0 });
    expect(result.document.extractionError).toMatch(/passt nicht zum Belegschema/);
    expect(result.amounts).toEqual([]);
    expect(anthropic.extractWithAnthropic).not.toHaveBeenCalled();
    expect(await sql`select 1 from journal_entries`).toHaveLength(0);
    // Das Log nennt Anbieter, Modell und Fehlerart, nicht die Antwort
    expect(warn.mock.calls.flat().join(" ")).not.toContain("lieferant");
    warn.mockRestore();
  });

  it("E-Rechnungen liest Haben weiter zuerst ohne KI", async () => {
    const einvoice = await import("@haben/einvoice");
    const lines = [{ description: "Mobilfunk", quantity: 1000, unit: "Monat" as const, unitPrice: 3857, taxRate: 1900 as const }];
    const { pdf } = await einvoice.buildEInvoice({
      kind: "rechnung",
      format: "zugferd",
      number: "MF-2026-10",
      issueDate: "2026-10-29",
      dueDate: "2026-11-12",
      paymentTermDays: 14,
      currency: "EUR",
      seller: {
        name: "Telekom Deutschland GmbH",
        strasse: "Landgrabenweg 151",
        plz: "53227",
        ort: "Bonn",
        land: "DE",
        email: "rechnung@telekom.example",
        ustId: "DE123475223",
        iban: "DE92760700120750007700",
      },
      buyer: { name: "Testfirma", strasse: "Musterstraße 1", plz: "93047", ort: "Regensburg", land: "DE", email: "a@b.example" },
      lines: lines.map((l, i) => ({ ...l, position: i + 1, net: l.unitPrice })),
      totals: computeInvoiceTotals(lines),
    });
    const { id } = await documents.uploadDocument(actor, { bytes: pdf, filename: "telekom.pdf" });
    expect((await documents.getDocument(id))!.document).toMatchObject({ extractedBy: "zugferd", invoiceNumber: "MF-2026-10" });
    expect(service.requests).toHaveLength(0);
  });

  it.skipIf(!hasPdftoppm)("PDF ohne E-Rechnung geht als Seitenbilder an den Dienst", async () => {
    const pdf = new Uint8Array(NodeCompiler.create().pdf({ mainFileContent: "Rechnung MF-2026-09\n#pagebreak()\nSeite 2" }));
    const { id } = await documents.uploadDocument(actor, { bytes: pdf, filename: "scan.pdf" });
    expect((await documents.getDocument(id))!.document).toMatchObject({ extractionStatus: "fertig", supplierName: "Telekom Deutschland GmbH" });
    const content = (service.requests[0]!.body.messages as { role: string; content: unknown }[]).find((m) => m.role === "user")!.content as {
      type: string;
      image_url?: { url: string };
    }[];
    const images = content.filter((part) => part.type === "image_url").map((part) => part.image_url!.url);
    expect(images).toHaveLength(2);
    for (const url of images) expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });
});
