import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Übernommen wird nur in eine neue Instanz (#488, Vorgabe des Maintainers im Issue): Es gibt noch keine Stammdaten, die
 * mit denen aus der Datei zusammenstoßen, und nichts Gebuchtes, an dem Sperren hängen. Firmendaten, Logo, Gestaltung und
 * E-Mail-Versand dürfen schon eingerichtet sein; die Datei überschreibt sie, außer dem Zugang zum Versand.
 */

const BELEGT: readonly [string, PgTable][] = [
  ["Kontakte", schema.contacts],
  ["Artikel", schema.articles],
  ["eigene Einheiten", schema.units],
  ["Textbausteine", schema.textBlocks],
  ["eigene Konten", schema.ownAccounts],
  ["eigene Layouts", schema.belegLayouts],
  ["eigene Seiten", schema.customPages],
  ["Standardanhänge", schema.quoteDefaultAttachments],
  ["Rechnungen", schema.invoices],
  ["Angebote", schema.quotes],
  ["Belege", schema.documents],
  ["Buchungen", schema.journalEntries],
  ["Bankumsätze", schema.bankTransactions],
  ["Kassenbuch", schema.cashEntries],
  ["Anlagen", schema.assets],
  ["Mitarbeiter", schema.employees],
  ["Leistungen", schema.serviceEntries],
];

/** Was die Instanz schon hat, leer heißt neu */
export async function schonAngelegt(q: Db | Tx = db): Promise<string[]> {
  const belegt: string[] = [];
  for (const [name, table] of BELEGT) {
    const [row] = await q.select({ eins: sql<number>`1` }).from(table).limit(1);
    if (row) belegt.push(name);
  }
  return belegt;
}

export function nichtNeuMeldung(belegt: readonly string[]): string {
  const liste = belegt.length > 1 ? `${belegt.slice(0, -1).join(", ")} und ${belegt.at(-1)}` : belegt[0];
  return `Einstellungen lassen sich nur in eine neue Instanz übernehmen. Hier gibt es schon ${liste}.`;
}
