import { sondervorauszahlungFor, type Cents } from "@haben/core";
import { and, desc, eq, lte } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { loadDauerfrist } from "../umsatzsteuer/index.ts";

/**
 * Kz 83 der zuletzt gesendeten Voranmeldung je Monat eines Jahres (bei Berichtigungen die berichtigte). Mit `bis` nur die bis
 * dahin gesendeten oder vermerkten: So rechnet der Abgleich nach, welche Vorauszahlungen beim Vermerk einer
 * Umsatzsteuererklärung bekannt waren (#1231).
 */
export async function zuletztGesendet(year: number, bis?: Date): Promise<Map<number, Cents>> {
  const v = schema.vatReturns;
  const sent = await db
    .select({ month: v.month, kz83: v.kz83 })
    .from(v)
    .where(and(eq(v.year, year), eq(v.status, "sent"), bis ? lte(v.sentAt, bis) : undefined))
    .orderBy(desc(v.sentAt));
  const latest = new Map<number, Cents>();
  for (const row of sent) if (!latest.has(row.month)) latest.set(row.month, row.kz83);
  return latest;
}

/**
 * Vorauszahlungssoll einschließlich der Sondervorauszahlung: Um sie ist die Voranmeldung für Dezember gemindert (Kz 39).
 * Quelle: ELSTER-Anleitung USt 2025, Zeile 119 (einschließlich Sondervorauszahlung, unabhängig vom tatsächlichen Geldfluss).
 * https://www.elster.de/eportal/helpGlobal?themaGlobal=help_ust_ufa_50_2025
 */
export async function vorauszahlungssoll(year: number, latest: ReadonlyMap<number, Cents>): Promise<Cents> {
  return [...latest.values()].reduce((s, v) => s + v, 0) + sondervorauszahlungFor(await loadDauerfrist(), year);
}
