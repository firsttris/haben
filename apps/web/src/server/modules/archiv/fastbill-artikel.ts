import { type FbArticle, fbArticlesCsv } from "@haben/import";
import { withFastbillRequest } from "./fastbill-anfrage.ts";
import { FastbillError } from "./fastbill-zugang.ts";

/*
 * Artikel aus FastBill für den Artikel-Import (docs/fastbill.md#artikel): Der Abruf liefert eine CSV in den Spalten des
 * Imports, die Seite „CSV-Import“ zeigt dazu die übliche Vorschau, und übernommen wird dort wie aus einer Datei. So gelten
 * dieselben Prüfungen und Dubletten wie bei jeder Artikelliste, und Haben speichert nichts, bevor du bestätigst.
 * Je 100 Artikel ein Aufruf, in der Anfrage mit der Stundengrenze (fastbill-anfrage.ts).
 */
export async function fastbillArticlesCsv(): Promise<{ filename: string; csv: string; count: number }> {
  const articles = await withFastbillRequest("Artikel", async (client) => {
    const list: FbArticle[] = [];
    for await (const article of client.articles()) list.push(article);
    return list;
  });
  if (articles.length === 0) throw new FastbillError("In FastBill sind keine Artikel angelegt.");
  return { filename: "fastbill-artikel.csv", csv: fbArticlesCsv(articles), count: articles.length };
}
