import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Keine KI-Auslesung im Test
vi.mock("../belege/extraction.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../belege/extraction.ts")>()),
  extractionAvailable: () => false,
}));

/*
 * Jahresarchiv und eigene Sachkonten (#270): belege.csv nennt das eigene Konto zusätzlich zur Kategorie, am Beleg die Nummer, bei
 * einer Aufteilung je Zeile in der Reihenfolge der Kategorien. Alle Daten sind erfunden.
 */

const text = (bytes: Uint8Array | undefined) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

describe.skipIf(!testDatabaseUrl)("Jahresarchiv mit eigenen Konten (Postgres, #270)", () => {
  let sql: postgres.Sql;
  let rows: Record<string, string>[];
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    const documents = await import("../belege/documents.ts");
    const konten = await import("../eigene-konten/index.ts");
    const exporter = await import("./export.ts");

    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', 'ist', 'SKR03')`;
    const software = await konten.createOwnAccount(actor, { account: "4999", name: "Software: Entwicklung", parentCategory: "software" });
    const telefon = await konten.createOwnAccount(actor, { account: "4998", name: "Telefon: Mobil", parentCategory: "telefon" });

    let seq = 0;
    const beleg = async (supplier: string, extra: Record<string, unknown>) => {
      seq++;
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, seq, 1, 2, 3, 0xff, 0xd9]);
      const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${seq}.jpg` });
      await documents.updateDocument(actor, id, {
        supplierName: supplier,
        supplierUstId: "",
        invoiceNumber: `R-${seq}`,
        documentDate: "2026-09-15",
        dueDate: null,
        payment: "privat",
        note: "",
        amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
        splits: [],
        category: null,
        ...extra,
      } as never);
      await documents.bookDocument(actor, id);
    };
    await beleg("Mobilfunk Nord", { category: "telefon", ownAccountId: telefon });
    await beleg("Ohne Konto", { category: "buero" });
    await beleg("Aufgeteilt AG", {
      splits: [
        { category: "software", ownAccountId: software, taxRate: 1900, net: 6_000 },
        { category: "buero", taxRate: 1900, net: 4_000 },
      ],
    });

    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2026, new Date("2026-10-02T10:00:00Z"))) chunks.push(chunk);
    const csv = text(unzipSync(Buffer.concat(chunks))["belege/belege.csv"])
      .split("\r\n")
      .filter(Boolean);
    const header = csv[0]!.split(";");
    rows = csv.slice(1).map((line) => Object.fromEntries(line.split(";").map((cell, i) => [header[i]!, cell])));
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  const zeile = (lieferant: string) => rows.find((r) => r.Lieferant === lieferant)!;

  it("belege.csv hat die Spalte „Eigenes Konto“ direkt nach der Kategorie", () => {
    expect(Object.keys(zeile("Mobilfunk Nord")).slice(4, 6)).toEqual(["Kategorie", "Eigenes Konto"]);
  });

  it("am Beleg steht die Nummer, die Kategorie bleibt", () => {
    expect(zeile("Mobilfunk Nord")).toMatchObject({ Kategorie: "telefon", "Eigenes Konto": "4998" });
  });

  it("ohne eigenes Konto bleibt die Spalte leer", () => {
    expect(zeile("Ohne Konto")).toMatchObject({ Kategorie: "buero", "Eigenes Konto": "" });
  });

  it("bei einer Aufteilung steht die Nummer je Zeile in der Reihenfolge der Kategorien, „–“ ohne eigenes Konto", () => {
    const aufgeteilt = zeile("Aufgeteilt AG");
    expect(aufgeteilt.Kategorie).toBe("software 19 % 60,00 | buero 19 % 40,00");
    expect(aufgeteilt["Eigenes Konto"]).toBe("4999 | –");
  });
});
