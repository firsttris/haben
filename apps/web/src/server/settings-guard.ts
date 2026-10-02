import { count, gte } from "drizzle-orm";
import { openItems } from "./bank.ts";
import type { Company, CompanyInput } from "./company.ts";
import { db, schema } from "./db/index.ts";

/** Warum sich Kontenrahmen, Versteuerung oder Kleinunternehmer gerade nicht ändern lassen; null = frei */
export interface SettingsLocks {
  kontenrahmen: string | null;
  versteuerung: string | null;
  /** Nur das Einschalten; ausschalten geht immer, weil der Status mitten im Jahr enden kann */
  kleinunternehmer: string | null;
}

/**
 * Kontenrahmen, Versteuerungsart und Kleinunternehmerstatus gelten für ein ganzes Geschäftsjahr.
 * Gibt es im laufenden Jahr schon Buchungen, passen alte und neue Buchungen nicht mehr zusammen.
 * Beim Wechsel der Versteuerung würden offene Rechnungen zusätzlich doppelt oder gar nicht
 * angemeldet (Ist: bei Zahlung, Soll: bei Rechnung).
 */
export async function settingsLocks(today: string): Promise<SettingsLocks> {
  const year = today.slice(0, 4);
  const [entries] = await db
    .select({ n: count() })
    .from(schema.journalEntries)
    .where(gte(schema.journalEntries.date, `${year}-01-01`));
  const booked = (entries?.n ?? 0) > 0;
  const openInvoices = (await openItems()).filter((item) => item.type === "invoice").length;
  const yearLock = booked
    ? `Im Jahr ${year} gibt es schon Buchungen. Umstellen nur zum Jahreswechsel, bevor im neuen Jahr gebucht wird.`
    : null;
  return {
    kontenrahmen: yearLock,
    versteuerung:
      yearLock ??
      (openInvoices > 0
        ? `${openInvoices} ${openInvoices === 1 ? "Rechnung ist" : "Rechnungen sind"} noch offen. Nach einem Wechsel würde ihre Umsatzsteuer doppelt oder gar nicht angemeldet; erst ausgleichen, dann umstellen.`
        : null),
    kleinunternehmer: yearLock,
  };
}

/** Fehlermeldung, wenn die Eingabe eine gesperrte Einstellung ändert */
export function lockedChange(current: Company, next: CompanyInput, locks: SettingsLocks): string | null {
  if (next.kontenrahmen !== current.kontenrahmen && locks.kontenrahmen) return `Kontenrahmen: ${locks.kontenrahmen}`;
  if (next.versteuerung !== current.versteuerung && locks.versteuerung) return `Versteuerung: ${locks.versteuerung}`;
  if (next.kleinunternehmer && !current.kleinunternehmer && locks.kleinunternehmer) return `Kleinunternehmer: ${locks.kleinunternehmer}`;
  return null;
}
