import { FastbillApiError, type FbArticle, fbArticlesCsv } from "@haben/import";
import { latestFastbillImport } from "./fastbill.ts";
import { FastbillError, fastbillCredentials, newFastbillClient } from "./fastbill-zugang.ts";

/*
 * Artikel aus FastBill für den Artikel-Import (docs/fastbill.md#artikel): Der Abruf liefert eine CSV in den Spalten des
 * Imports, die Seite „CSV-Import“ zeigt dazu die übliche Vorschau, und übernommen wird dort wie aus einer Datei. So gelten
 * dieselben Prüfungen und Dubletten wie bei jeder Artikelliste, und Haben speichert nichts, bevor du bestätigst.
 *
 * Der Abruf läuft in der Anfrage, nicht im Hintergrund: Je 100 Artikel ein Aufruf. Die Aufrufe des letzten Abrufs zählen
 * auf die Stundengrenze an; ist sie erreicht, bricht er ab, statt bis zu einer Stunde in der Anfrage zu warten.
 */

/** Längste Wartezeit in der Anfrage: Mindestabstand und kurze Wiederholungen ja, die Stundengrenze nein */
const MAX_WAIT_MS = 30_000;

function waitBriefly(ms: number): Promise<void> {
  if (ms > MAX_WAIT_MS) {
    const minutes = Math.ceil(ms / 60_000);
    return Promise.reject(new FastbillError(`Die Stundengrenze deines FastBill-Tarifs ist erreicht. Hol die Artikel in ${minutes} Minuten.`));
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fastbillArticlesCsv(): Promise<{ filename: string; csv: string; count: number }> {
  const login = await fastbillCredentials();
  if (!login) throw new FastbillError("Zuerst im Umzug aus FastBill Login-E-Mail und API-Schlüssel hinterlegen.");
  const last = await latestFastbillImport();
  if (last?.status === "laeuft") throw new FastbillError("Gerade läuft ein Abruf aus FastBill. Hol die Artikel, wenn er fertig ist.");
  const client = newFastbillClient({ ...login, previousCalls: last?.progress.fastbillCalls ?? [], sleep: waitBriefly });
  const articles: FbArticle[] = [];
  try {
    for await (const article of client.articles()) articles.push(article);
  } catch (error) {
    if (error instanceof FastbillApiError) throw new FastbillError(`FastBill: ${error.message}`, { cause: error });
    throw error;
  }
  if (articles.length === 0) throw new FastbillError("In FastBill sind keine Artikel angelegt.");
  return { filename: "fastbill-artikel.csv", csv: fbArticlesCsv(articles), count: articles.length };
}
