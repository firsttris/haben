import { FB_PARTLY_CANCELED } from "@haben/import";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import type { ReconciliationCheck } from "./lexoffice.ts";

/*
 * FastBill im Abgleich je Jahr (reconciliation in lexoffice.ts): Steuerart aus VAT_CASE und die offenen Punkte für Ausgaben,
 * die noch auf ihren Beleg aus dem Browser-Skript warten, und für Rechnungen mit Teilstorno.
 */

/** Ausgaben aus FastBill, die noch auf ihren Beleg warten, liegen nicht im Archiv: Solange es sie gibt, ist das Jahr nicht vollständig */
export function fastbillWaitingChecks(waiting: number | undefined): ReconciliationCheck[] {
  if (!waiting) return [];
  return [
    {
      ok: false,
      label: "Keine Ausgabe wartet auf ihren Beleg",
      detail: `${waiting} ${waiting === 1 ? "Ausgabe aus FastBill wartet" : "Ausgaben aus FastBill warten"}`,
    },
  ];
}

/** Je Jahr, wie viele Rechnungen aus FastBill storniert sind, ohne dass eine Gutschrift sie voll aufhebt (map.ts, mapFbInvoice) */
export async function fastbillPartlyCanceledByYear(): Promise<Map<number, number>> {
  const rows = await db
    .select({ year: sql<number>`extract(year from ${schema.lexofficeVouchers.date})::int`, count: sql<number>`count(*)::int` })
    .from(schema.lexofficeVouchers)
    .where(and(eq(schema.lexofficeVouchers.source, "fastbill"), eq(schema.lexofficeVouchers.status, FB_PARTLY_CANCELED)))
    .groupBy(sql`1`);
  return new Map(rows.map((r) => [r.year, r.count]));
}

/** Ob FastBill nach einem Teilstorno die Rechnung auf storniert setzt, ist nicht belegt: Haben rechnet mit dem vollen Betrag und bittet um Prüfung */
export function fastbillPartlyCanceledChecks(count: number | undefined): ReconciliationCheck[] {
  if (!count) return [];
  return [
    {
      ok: false,
      label: "Keine Rechnung mit Teilstorno zu prüfen",
      detail: `${count} ${count === 1 ? "Rechnung" : "Rechnungen"} aus FastBill mit Teilstorno: bitte prüfen`,
    },
  ];
}
