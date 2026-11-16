import { formatEuro } from "@haben/core";
import { desc, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import type { JournalUmstellungBefund } from "../../db/schema.ts";
import { abgleichJahr, abweichungen } from "../auswertungen/index.ts";
import { erklaerteAbweichungen, erklaertText } from "../jahreserklaerung/index.ts";

/*
 * Prüfung beim Update auf das Journal als einzige Quelle von Voranmeldung und EÜR (#1116, docs/adr/journal-einzige-quelle.md).
 * Bis 0.9 rechneten Jahre vor dem Stichjahr (company.journal_ab, Migration 0192) aus den Nebenbüchern. Ältere Buchungen
 * tragen dort teils keine Bemessungsgrundlage oder keinen Steuerschlüssel; aus dem Journal käme dann etwas anderes heraus.
 * Statt die alte Rechnung danebenzuhalten, prüft Haben diese Jahre wie der Abgleich in der Integritätsprüfung:
 * - gesendete Voranmeldungen mit ihren gespeicherten Werten gegen die Rechnung aus dem Journal (gesendet ist gesendet);
 * - die Verprobung je Buchung: Steuer ohne passende Bemessungsgrundlage fällt auf, genau die Lücke älterer Buchungen;
 * - Rechnung und Vorgang gegen ihre Buchung;
 * - übermittelte und vermerkte Umsatzsteuererklärungen und Anlagen EÜR gegen die Rechnung aus dem Journal.
 * Offene Voranmeldungszeiträume und nicht abgegebene Jahreserklärungen vergleicht die Prüfung nicht mit der bisherigen
 * Rechnung; für sie gilt ab jetzt das Journal. Besteht alles, gilt die Umstellung als bestanden. Sonst startet die neue Version nicht (cli.ts), bis die Abweichung ausdrücklich übernommen wird.
 */

export const UMSTELLUNG_ACTOR = "system:umstellung";

export type UmstellungStand = typeof schema.journalUmstellung.$inferSelect;

/** Die zuletzt gespeicherte Prüfung; null nur in einer Datenbank, die die Migration noch nicht kennt */
export async function umstellungStand(q: Db | Tx = db): Promise<UmstellungStand | null> {
  const [stand] = await q.select().from(schema.journalUmstellung).orderBy(desc(schema.journalUmstellung.id)).limit(1);
  return stand ?? null;
}

/** Jahre mit Buchungen vor dem Stichjahr */
async function jahreVor(stichjahr: number, q: Db | Tx): Promise<number[]> {
  const e = schema.journalEntries;
  const rows = await q
    .selectDistinct({ year: sql<number>`extract(year from ${e.date})::int` })
    .from(e)
    .where(sql`extract(year from ${e.date}) < ${stichjahr}`)
    .orderBy(sql`1`);
  return rows.map((r) => Number(r.year));
}

/**
 * Was in den Jahren vor dem früheren Stichjahr nicht stimmt; leer = bestanden. Dieselben Prüfungen wie der Abgleich in der
 * Integritätsprüfung (abgleichJahr): gesendete Voranmeldungen gegen das Journal, Verprobung der Umsatzsteuer je Buchung,
 * Rechnung und Vorgang gegen ihre Buchung; dazu übermittelte und vermerkte Jahreserklärungen.
 */
export async function umstellungBefunde(stichjahr: number, today: string, q: Db | Tx = db): Promise<JournalUmstellungBefund[]> {
  const befunde: JournalUmstellungBefund[] = [];
  for (const jahr of await jahreVor(stichjahr, q)) {
    const { zeilen } = await abgleichJahr(jahr, today, q, new Set());
    for (const z of abweichungen(zeilen).filter((x) => x.bereich === "ustva" || x.bereich === "beleg"))
      befunde.push({ jahr, text: `${z.zeitraum} ${z.posten}: im Journal ${formatEuro(z.journal)}, ${z.gegen} ${formatEuro(z.quelle)}` });
    for (const x of await erklaerteAbweichungen([jahr])) befunde.push({ jahr, text: erklaertText(x) });
  }
  return befunde;
}

export type UmstellungErgebnis =
  /** Nichts zu prüfen oder schon geprüft */
  | { status: "fertig"; stand: UmstellungStand | null }
  /** Jetzt geprüft und gespeichert (bestanden oder übernommen) */
  | { status: "gespeichert"; stand: UmstellungStand }
  /** Abweichungen in Jahren, die nicht übernommen sind; nichts gespeichert */
  | { status: "abweichung"; befunde: JournalUmstellungBefund[] };

/**
 * Prüft die Umstellung, wenn sie offen ist, und speichert das Ergebnis. `uebernehmen`: Jahre, deren Abweichungen
 * ausdrücklich übernommen werden (HABEN_ABWEICHUNG_UEBERNEHMEN); dann gelten ab jetzt die Zahlen aus dem Journal, gesendete
 * Voranmeldungen bleiben, wie sie in vat_returns stehen.
 */
export async function umstellungPruefen(today: string, uebernehmen: readonly number[] = [], version: string | null = null): Promise<UmstellungErgebnis> {
  const stand = await umstellungStand();
  if (stand?.ergebnis !== "offen") return { status: "fertig", stand };
  const befunde = stand.stichjahrVorher === null ? [] : await umstellungBefunde(stand.stichjahrVorher, today);
  const offen = befunde.filter((b) => !uebernehmen.includes(b.jahr));
  if (offen.length > 0) return { status: "abweichung", befunde: offen };
  const ergebnis = befunde.length === 0 ? "bestanden" : "uebernommen";
  const [neu] = await withActor(UMSTELLUNG_ACTOR, (tx) =>
    tx.insert(schema.journalUmstellung).values({ stichjahrVorher: stand.stichjahrVorher, ergebnis, befunde, version }).returning(),
  );
  return { status: "gespeichert", stand: neu! };
}
