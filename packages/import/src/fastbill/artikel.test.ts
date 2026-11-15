import { describe, expect, it } from "vitest";
import { ARTICLE_FIELDS, articleCandidates } from "../csv-import/articles.ts";
import { suggestMapping } from "../csv-import/mapping.ts";
import { readCsvTable } from "../csv-import/read.ts";
import { fbArticlesCsv } from "./artikel.ts";
import type { FbArticle } from "./types.ts";

// Artikel in der Form von article.get; Nummern, Namen und Preise erfunden
const article = (fields: Partial<FbArticle>): FbArticle => ({
  ARTICLE_ID: "1",
  ARTICLE_NUMBER: "A-1",
  TITLE: "Beratung",
  DESCRIPTION: "",
  UNIT: "Stunde",
  UNIT_PRICE: "100.00",
  CURRENCY_CODE: "EUR",
  VAT_PERCENT: "19.00",
  IS_GROSS: "0",
  ...fields,
});

/** Die CSV so lesen, wie der Artikel-Import sie liest: Spalten nach Namen zugeordnet, ohne Eingriff */
function imported(articles: FbArticle[]) {
  const read = readCsvTable(new TextEncoder().encode(fbArticlesCsv(articles)), { encoding: "auto", delimiter: "auto" });
  if (!read.ok) throw new Error(read.error);
  return articleCandidates(read.table, suggestMapping(read.table.header, ARTICLE_FIELDS));
}

describe("fbArticlesCsv", () => {
  it("übernimmt netto eingegebene Artikel mit Nettopreis, Einheit und Steuersatz", () => {
    const [row] = imported([article({ ARTICLE_NUMBER: 1001, TITLE: "Beratung", DESCRIPTION: "je angefangene Stunde", UNIT_PRICE: "84.50" })]);
    expect(row).toMatchObject({
      errors: [],
      value: {
        number: "1001",
        description: "Beratung",
        detail: "je angefangene Stunde",
        unit: "Std.",
        unitPrice: 8450,
        priceIncludesTax: false,
        taxRate: 1900,
      },
    });
  });

  it("rechnet bei IS_GROSS 1 den Endpreis aus dem Nettopreis zurück, den FastBill liefert", () => {
    // FastBill liefert brutto eingegebene Preise netto mit vier Nachkommastellen, etwa 100,00 € bei 19 % als 84,0336
    const rows = imported([
      article({ ARTICLE_NUMBER: "B-19", IS_GROSS: "1", UNIT_PRICE: "84.0336", VAT_PERCENT: "19.00" }),
      article({ ARTICLE_NUMBER: "B-7", IS_GROSS: 1, UNIT_PRICE: 9.3458, VAT_PERCENT: 7 }),
      article({ ARTICLE_NUMBER: "B-0", IS_GROSS: "1", UNIT_PRICE: "12.50", VAT_PERCENT: "0" }),
    ]);
    expect(rows.map((r) => r.value && { unitPrice: r.value.unitPrice, gross: r.value.priceIncludesTax, rate: r.value.taxRate })).toEqual([
      { unitPrice: 10_000, gross: true, rate: 1900 },
      { unitPrice: 1000, gross: true, rate: 700 },
      { unitPrice: 1250, gross: true, rate: 0 },
    ]);
  });

  it("rundet Nettopreise mit mehr als zwei Nachkommastellen kaufmännisch auf den Cent", () => {
    const rows = imported([article({ UNIT_PRICE: "10.005" }), article({ ARTICLE_NUMBER: "A-2", UNIT_PRICE: "-2.345" })]);
    expect(rows.map((r) => r.value?.unitPrice)).toEqual([1001, -235]);
  });

  it("lässt Preise in anderer Währung als Euro nicht still als Euro durch", () => {
    const [row] = imported([article({ CURRENCY_CODE: "USD", UNIT_PRICE: "12.00" })]);
    expect(row!.value).toBeNull();
    expect(row!.errors.join(" ")).toContain("USD");
  });

  it("meldet fehlende Bezeichnung und Steuersätze, die der Artikelkatalog nicht kennt, statt sie zu ersetzen", () => {
    const rows = imported([
      article({ TITLE: "" }),
      article({ ARTICLE_NUMBER: "A-2", VAT_PERCENT: "16" }),
      article({ ARTICLE_NUMBER: "A-3", UNIT_PRICE: null }),
    ]);
    expect(rows[0]!.errors).toContain("Bezeichnung fehlt");
    expect(rows[1]!.value).toBeNull();
    expect(rows[1]!.errors.join(" ")).toMatch(/16/);
    expect(rows[2]!.errors).toContain("Preis fehlt (Netto- oder Bruttopreis)");
  });

  it("meldet eine Einheit aus FastBill, die Haben nicht kennt, als Fehler der Zeile statt Stück", () => {
    const rows = imported([article({ UNIT: "Lizenz" }), article({ ARTICLE_NUMBER: "A-2", UNIT: "" })]);
    expect(rows[0]!.value).toBeNull();
    expect(rows[0]!.errors.join(" ")).toContain("Einheit: „Lizenz“");
    expect(rows[1]!.value?.unit).toBe("Stk.");
  });

  it("maskiert Semikolon, Anführungszeichen und Zeilenumbruch, damit jede Zeile ein Artikel bleibt", () => {
    const rows = imported([article({ TITLE: 'Paket "Groß"; inkl. Anfahrt', DESCRIPTION: "Zeile 1\nZeile 2" }), article({ ARTICLE_NUMBER: "A-2" })]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.value).toMatchObject({ description: 'Paket "Groß"; inkl. Anfahrt', detail: "Zeile 1\nZeile 2" });
  });
});
