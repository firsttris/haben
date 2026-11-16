import { sql } from "drizzle-orm";
import * as schema from "./schema.ts";

/**
 * Für Abfragen auf `bank_transactions`: Der Umsatz steckt in einer gültigen Verrechnung mit einem gegenläufigen Umsatz
 * (#457, Funktion haben_bank_neutralized in drizzle/). Er gilt dann als erledigt, ohne Zuordnung und ohne Buchung.
 */
// Tabelle ausdrücklich nennen: in der Spaltenliste schreibt drizzle nur "id", das träfe in Unterabfragen a.id
export const bankNeutralizedSql = sql<boolean>`haben_bank_neutralized(${schema.bankTransactions}.id)`;

/**
 * Noch nicht erledigter Teil eines Umsatzes: Betrag minus Zuordnungen, null bei einem verrechneten Umsatz. Bankabgleich,
 * Kontenliste und die Vorprüfung der Voranmeldung rechnen damit gleich.
 */
export const bankOpenAmountSql = sql<number>`(case when ${bankNeutralizedSql} then 0 else ${schema.bankTransactions.amount} - coalesce((select sum(a.amount) from allocations a where a.transaction_id = ${schema.bankTransactions}.id), 0) end)`;

/**
 * Für Abfragen auf `bank_transactions` und `bank_imports`: das Konto gehört zu dieser Firma. Ein ausgeschlossenes Konto
 * (#462) fehlt in Abgleich, Vorprüfung, Jahresauswahl und Export; seine Umsätze bleiben in der Datenbank.
 */
export const bankAccountIncludedSql = (accountIdColumn: string) =>
  sql.raw(`${accountIdColumn} not in (select id from bank_accounts where excluded_at is not null)`);

/**
 * Für Abfragen auf `bank_transactions`: Der Umsatz gilt als „privat, kein Betriebsvorgang“ (#1088). Die Kennzeichnung
 * wirkt nur, solange das Konto privat ist und der Umsatz ganz offen: Auf einem Geschäftskonto oder mit einer
 * Zuordnung ist er wieder ein offener Posten; die Zeile in `bank_private_marks` bleibt und gilt wieder, wenn beides
 * zurückkehrt.
 */
export const bankPrivateMarkedSql = sql<boolean>`(exists (select 1 from ${schema.bankPrivateMarks} m where m.transaction_id = ${schema.bankTransactions}.id)
  and exists (select 1 from bank_accounts pa where pa.id = ${schema.bankTransactions}.bank_account_id and pa.purpose = 'privat')
  and ${bankOpenAmountSql} = ${schema.bankTransactions}.amount)`;

/** Gegenteil von `bankPrivateMarkedSql`: Ein gekennzeichneter Umsatz zählt weder im Bankabgleich noch in der Vorprüfung als offen */
export const bankNotPrivateMarkedSql = sql<boolean>`not ${bankPrivateMarkedSql}`;
