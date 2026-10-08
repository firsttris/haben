import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { listAssets } from "./assets.ts";
import type { Company, CompanyInput } from "./company.ts";
import { db, schema } from "./db/index.ts";

/** Warum sich Kontenrahmen, Versteuerung oder Kleinunternehmer gerade nicht ändern lassen; null = frei */
export interface SettingsLocks {
  kontenrahmen: string | null;
  versteuerung: string | null;
  /** Nur das Einschalten; ausschalten geht immer, weil der Status mitten im Jahr enden kann */
  kleinunternehmer: string | null;
}

/** Auf eine Rechnung gezahlt (Summe der Zuordnungen) */
const paidOn = (invoiceId: unknown) => sql`coalesce((select sum(a.amount) from allocations a where a.invoice_id = ${invoiceId}), 0)`;

/** Offene Rechnungen wie im Bankabgleich (openItems), nur gezählt */
async function openInvoiceCount(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.status, "final"),
        sql`case
          when ${schema.invoices.kind} = 'storno' then -${paidOn(schema.invoices.correctsId)} - ${paidOn(schema.invoices.id)}
          when ${schema.invoices.id} in (select corrects_id from invoices where kind = 'storno' and status = 'final' and corrects_id is not null) then 0
          else ${schema.invoices.gross} - ${paidOn(schema.invoices.id)}
        end <> 0`,
      ),
    );
  return row?.n ?? 0;
}

/** Was im Vorjahr noch zu buchen ist: AfA bzw. Privatnutzung der Anlagen und Belege mit Datum im Vorjahr */
async function previousYearOpen(year: number): Promise<string[]> {
  const pendingAssets = (await listAssets(year - 1)).filter((a) => a.pending).length;
  const [documents] = await db
    .select({ n: count() })
    .from(schema.documents)
    .where(and(eq(schema.documents.status, "neu"), gte(schema.documents.documentDate, `${year - 1}-01-01`), lt(schema.documents.documentDate, `${year}-01-01`)));
  const unbooked = documents?.n ?? 0;
  return [
    pendingAssets > 0 && `AfA für ${pendingAssets === 1 ? "eine Anlage" : `${pendingAssets} Anlagen`}`,
    unbooked > 0 && `${unbooked === 1 ? "ein Beleg" : `${unbooked} Belege`}`,
  ].filter((text): text is string => Boolean(text));
}

/**
 * Kontenrahmen, Versteuerungsart und Kleinunternehmerstatus gelten für ein ganzes Geschäftsjahr.
 * Gibt es im laufenden Jahr schon Buchungen, passen alte und neue Buchungen nicht mehr zusammen.
 * Dasselbe gilt, solange im Vorjahr noch etwas zu buchen ist (AfA zum 31.12., Dezember-Belege).
 * Beim Wechsel der Versteuerung würden offene Rechnungen zusätzlich doppelt oder gar nicht
 * angemeldet (Ist: bei Zahlung, Soll: bei Rechnung).
 */
export async function settingsLocks(today: string): Promise<SettingsLocks> {
  const year = Number(today.slice(0, 4));
  const [entries] = await db
    .select({ n: count() })
    .from(schema.journalEntries)
    .where(gte(schema.journalEntries.date, `${year}-01-01`));
  const booked = (entries?.n ?? 0) > 0;
  const previousOpen = booked ? [] : await previousYearOpen(year);
  const openInvoices = await openInvoiceCount();
  const yearLock = booked
    ? `Im Jahr ${year} gibt es schon Buchungen. Umstellen nur zum Jahreswechsel, bevor im neuen Jahr gebucht wird.`
    : previousOpen.length > 0
      ? `Im Jahr ${year - 1} ist noch nicht alles gebucht (${previousOpen.join(", ")}). Erst das alte Jahr abschließen, dann umstellen.`
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
