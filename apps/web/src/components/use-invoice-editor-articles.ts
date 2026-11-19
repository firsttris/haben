import { convertPrice, formatDecimal, parseEuro, type UnitLabel } from "@haben/core";
import { useServerFn } from "@tanstack/react-start";
import { emptyLine, type LineState, type ParsedLine } from "../lib/editor-lines.ts";
import { saveArticle } from "../server/functions/articles.ts";
import type { ArticleOption } from "./ArticleCombobox.tsx";
import type { InvoiceEditorFigures } from "./use-invoice-editor-figures.ts";

// Positionen und Artikelkatalog: Artikel übernehmen, einfügen, neu anlegen und Positionen als Artikel speichern

export function useInvoiceEditorArticles(editor: InvoiceEditorFigures) {
  const { grossPrices, reload, run, setConfirming, setConfirmingDelete, setDirty, setLines, setNewArticle, special } = editor;
  const storeArticle = useServerFn(saveArticle);
  /** Preis eines Artikels für diese Rechnung: netto oder brutto umgerechnet, wenn der Artikel anders gepflegt ist */
  function articlePrice(article: ArticleOption): string {
    if (special) return formatDecimal(article.unitPrice);
    return formatDecimal(convertPrice(article.unitPrice, article.taxRate, article.priceIncludesTax ? "brutto" : "netto", grossPrices ? "brutto" : "netto"));
  }

  /** Auswahl aus dem Katalog: Die Position übernimmt Text, Nummer, Einheit, Preis und Steuersatz und bleibt danach frei änderbar */
  function pickArticle(lineKey: number, article: ArticleOption) {
    setLines((prev) =>
      prev.map((line) =>
        line.key === lineKey
          ? {
              ...line,
              description: article.description,
              // Ein Artikel ohne Text lässt einen schon eingegebenen Text der Position stehen
              detail: article.detail || line.detail,
              // Die Position merkt sich die Nummer, nicht den Artikel (#388)
              itemNumber: article.number,
              unit: article.unit as UnitLabel,
              unitPrice: articlePrice(article),
              taxRate: special ? 0 : (article.taxRate as 1900 | 700 | 0),
            }
          : line,
      ),
    );
    setDirty(true);
    setConfirming(false);
    setConfirmingDelete(false);
  }

  /** Neuer Artikel aus der Trefferliste: vorgefüllt mit dem getippten Text und dem, was in der Position schon steht */
  function openNewArticle(line: LineState, description: string) {
    const price = parseEuro(line.unitPrice);
    setNewArticle({
      lineKey: line.key,
      prefill: {
        description,
        detail: line.detail,
        number: line.itemNumber,
        unit: line.unit,
        taxRate: special ? 1900 : line.taxRate,
        priceIncludesTax: grossPrices,
        ...(price === null ? {} : { unitPrice: price }),
      },
    });
  }

  /** Position als Artikel in den Katalog übernehmen; die Position selbst bleibt unverändert */
  function storeAsArticle(p: ParsedLine) {
    void run(async () => {
      await storeArticle({
        data: {
          id: null,
          article: {
            number: p.itemNumber,
            description: p.description,
            detail: p.detail,
            unit: p.unit,
            unitPrice: p.unitPrice,
            taxRate: p.taxRate,
            priceIncludesTax: grossPrices,
          },
        },
      });
      await reload();
    }, `„${p.description}“ ist jetzt im Artikelkatalog.`);
  }

  /** Position aus dem Katalog; ersetzt eine noch leere einzige Zeile, sonst wird angehängt */
  function insertArticle(article: ArticleOption) {
    const line: LineState = {
      ...emptyLine(article.unit as UnitLabel, special ? 0 : (article.taxRate as 1900 | 700 | 0)),
      description: article.description,
      detail: article.detail,
      itemNumber: article.number,
      unitPrice: articlePrice(article),
    };
    setLines((prev) => (prev.length === 1 && !prev[0]!.description.trim() && !prev[0]!.unitPrice.trim() ? [line] : [...prev, line]));
    setDirty(true);
  }

  return { insertArticle, openNewArticle, pickArticle, storeAsArticle };
}
