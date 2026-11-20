import { sql } from "drizzle-orm";
import { schema } from "../../db/index.ts";

const updateAufDasJournal = sql`(select min(${schema.journalUmstellung.at}) from ${schema.journalUmstellung})`;

/**
 * Buchung aus einer Version vor dem Update auf das Journal (v0.10): angelegt vor der ersten Zeile in journal_umstellung,
 * die die Migration 0275 beim Update schreibt, oder der Storno einer solchen. Ein späterer Storno kehrt die gebuchten Zeilen
 * um, wenn die heutigen nicht auf jedem Konto dasselbe ergeben (zeilenWieHeute). Ohne die Tabelle oder ihre erste Zeile:
 * keine. Fällt journal_umstellung mit #1201 weg, muss dieser Zeitpunkt bleiben.
 */
const ausAlterVersion = sql`coalesce(
  (select o.created_at from journal_entries o where o.id = ${schema.journalEntries.reversesId}), ${schema.journalEntries.createdAt}
) < ${updateAufDasJournal}`;

/**
 * Belegbuchung aus einer alten Version: Nur solche kann Haben vor #551 geschrieben haben. mitBemessungWieHeute gilt nur
 * für sie, Buchungen neuer Versionen deutet es so nie um (#1396).
 */
export const belegAusAlterVersion = sql<boolean>`(${schema.journalEntries.sourceType} = 'document' and ${ausAlterVersion})`;

/**
 * Zuordnung im Bankabgleich oder Bareinnahme aus einer alten Version: Nur solche kann Haben vor #552 ohne
 * Bemessungsgrundlage geschrieben haben. zahlungenWieHeute gilt nur für sie (#1502).
 */
export const zahlungAusAlterVersion = sql<boolean>`(${schema.journalEntries.sourceType} in ('allocation', 'kasse') and ${ausAlterVersion})`;
