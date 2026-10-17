import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { listAssets } from "./assets.ts";
import { loadCompany, type Company, type CompanyInput } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { db, schema, type Db, type Tx } from "./db/index.ts";
import { UserError } from "./errors.ts";

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
async function openInvoiceCount(q: Db | Tx): Promise<number> {
  const [row] = await q
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
async function previousYearOpen(year: number, q: Db | Tx): Promise<string[]> {
  const pendingAssets = (await listAssets(year - 1, q)).filter((a) => a.pending).length;
  const [documents] = await q
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
export async function settingsLocks(today: string, q: Db | Tx = db): Promise<SettingsLocks> {
  const year = Number(today.slice(0, 4));
  const [entries] = await q
    .select({ n: count() })
    .from(schema.journalEntries)
    .where(gte(schema.journalEntries.date, `${year}-01-01`));
  const booked = (entries?.n ?? 0) > 0;
  const previousOpen = booked ? [] : await previousYearOpen(year, q);
  const openInvoices = await openInvoiceCount(q);
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

/**
 * Firmendaten speichern. Prüfung und Speichern laufen in einer Transaktion mit gesperrter Firmenzeile, damit jeder
 * Zugang (Oberfläche, später eine API oder der Scheduler) dieselbe Sperre bekommt. Den Kern der Jahressperre prüft
 * zusätzlich die Datenbank (drizzle/0065), auch für Änderungen an Haben vorbei.
 */
export async function saveCompany(actor: string, input: CompanyInput, today: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await loadCompany(tx);
    const [current] = await tx.select().from(schema.company).where(eq(schema.company.id, 1)).for("update");
    const locked = lockedChange(current!, input, await settingsLocks(today, tx));
    if (locked) throw new UserError(locked);
    await tx.update(schema.company).set({ ...input, updatedAt: new Date() }).where(eq(schema.company.id, 1));
  });
}
