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
