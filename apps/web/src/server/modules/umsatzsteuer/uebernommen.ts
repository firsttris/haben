import { desc } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/**
 * Jahre, deren Abweichungen beim Update auf das Journal ausdrücklich übernommen wurden (HABEN_ABWEICHUNG_UEBERNEHMEN,
 * #1116): In ihnen kann eine gesendete Voranmeldung von der Rechnung aus dem Journal abweichen, ohne dass das ein Fehler von
 * heute ist. Gelesen aus der letzten Zeile von journal_umstellung wie im Abgleich (auswertungen/abgleich.ts); das Modul
 * umstellung steht über diesem.
 */
export async function uebernommeneJahre(q: Db | Tx = db): Promise<Set<number>> {
  const [stand] = await q.select().from(schema.journalUmstellung).orderBy(desc(schema.journalUmstellung.id)).limit(1);
  return new Set(stand?.ergebnis === "uebernommen" ? stand.befunde.map((b) => b.jahr) : []);
}

/** Vorbelegte Begründung einer Berichtigung in einem übernommenen Jahr (#1200); in der Oberfläche änderbar */
export const uebernommenBegruendung = (year: number) =>
  `Jahr ${year} beim Update auf das Journal übernommen: Die Berichtigung beginnt mit den gesendeten Werten, nicht mit der Rechnung aus dem Journal.`;
