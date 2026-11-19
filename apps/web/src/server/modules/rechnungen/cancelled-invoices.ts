import { sql } from "drizzle-orm";

/** Festgeschriebene Rechnungen, die eine Stornorechnung aufhebt */
export const cancelledIds = sql`select corrects_id from invoices where kind = 'storno' and status = 'final' and corrects_id is not null`;

/**
 * Dieselbe Menge im Abschlussstand (#1110): nur Stornos, die es am Stichtag schon gab. Ein Storno im Folgejahr
 * nimmt die Forderung zum 31.12. nicht weg — sie war an diesem Tag offen.
 */
export const cancelledIdsUpTo = (bis: string) => sql`select corrects_id from invoices
  where kind = 'storno' and status = 'final' and corrects_id is not null and issue_date <= ${bis}`;
