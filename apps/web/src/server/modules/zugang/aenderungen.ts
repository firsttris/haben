import { and, count, eq, gt, lt, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { today } from "../../today.ts";
import { recentLogins } from "./zugaenge.ts";

/*
 * Hinweis für die Steuerberatung, was sich seit ihrem letzten Besuch geändert hat (wie der Beleg-Alert in Lexware Office).
 * Gezählt wird, was beim Durchsehen zählt: neue und gebuchte Belege, festgeschriebene Rechnungen, Buchungen, und davon
 * die, deren Buchungsdatum vor dem letzten Besuch liegt, also einen schon angesehenen Zeitraum ändern.
 */

export interface Aenderungen {
  /** Vorige Anmeldung; ohne sie (erster Besuch) gibt es nichts zu vergleichen */
  since: Date | null;
  neueBelege: number;
  gebuchteBelege: number;
  rechnungen: number;
  buchungen: number;
  rueckwirkend: number;
}

/** Was seit `since` dazugekommen ist */
export async function changesSince(since: Date): Promise<Omit<Aenderungen, "since">> {
  // Buchungsdatum nach deutscher Zeit, wie überall in Haben
  const sinceDate = today(since);
  const one = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;
  const [neueBelege, gebuchteBelege, rechnungen, buchungen, rueckwirkend] = await Promise.all([
    one(db.select({ n: count() }).from(schema.documents).where(gt(schema.documents.uploadedAt, since))),
    one(db.select({ n: count() }).from(schema.documents).where(gt(schema.documents.lockedAt, since))),
    one(
      db
        .select({ n: count() })
        .from(schema.invoices)
        .where(and(eq(schema.invoices.status, "final"), gt(schema.invoices.lockedAt, since))),
    ),
    one(db.select({ n: count() }).from(schema.journalEntries).where(gt(schema.journalEntries.createdAt, since))),
    one(
      db
        .select({ n: count() })
        .from(schema.journalEntries)
        .where(and(gt(schema.journalEntries.createdAt, since), lt(schema.journalEntries.date, sql`${sinceDate}::date`))),
    ),
  ]);
  return { neueBelege, gebuchteBelege, rechnungen, buchungen, rueckwirkend };
}

/** Änderungen seit der vorletzten Anmeldung von `userId`; die letzte ist die laufende Sitzung */
export async function changesSinceLastVisit(userId: string): Promise<Aenderungen> {
  const [, previous] = await recentLogins(userId, 2);
  if (!previous) return { since: null, neueBelege: 0, gebuchteBelege: 0, rechnungen: 0, buchungen: 0, rueckwirkend: 0 };
  return { since: previous.at, ...(await changesSince(previous.at)) };
}
