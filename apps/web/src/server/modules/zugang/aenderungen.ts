import { and, count, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { ssoOnly } from "../../sso-policy.ts";
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

/** SSO-Modus: Ohne Anmeldung vergeht so viel Zeit, bis ein neuer Besuch beginnt; die Frist von 15 Minuten erzeugt sonst laufend neue */
const SSO_BESUCH_PAUSE_STUNDEN = 6;

/** Letzte Anmeldung vor der jüngsten Pause von mehr als SSO_BESUCH_PAUSE_STUNDEN, also das Ende des vorigen Besuchs */
async function endOfPreviousSsoVisit(userId: string): Promise<Date | null> {
  const { at, id, userId: owner } = schema.userLogins;
  const logins = db
    .select({ at, newer: sql<string>`lag(${at}) over (order by ${at} desc, ${id} desc)`.as("newer") })
    .from(schema.userLogins)
    .where(eq(owner, userId))
    .as("logins");
  const [row] = await db
    .select({ at: logins.at })
    .from(logins)
    .where(sql`${logins.newer} - ${logins.at} > make_interval(hours => ${SSO_BESUCH_PAUSE_STUNDEN})`)
    .orderBy(desc(logins.at))
    .limit(1);
  return row?.at ?? null;
}

/** Änderungen seit dem vorigen Besuch von `userId`; lokal ist das die vorletzte Anmeldung, die letzte ist die laufende Sitzung */
export async function changesSinceLastVisit(userId: string): Promise<Aenderungen> {
  const since = ssoOnly() ? await endOfPreviousSsoVisit(userId) : ((await recentLogins(userId, 2))[1]?.at ?? null);
  if (!since) return { since: null, neueBelege: 0, gebuchteBelege: 0, rechnungen: 0, buchungen: 0, rueckwirkend: 0 };
  return { since, ...(await changesSince(since)) };
}
