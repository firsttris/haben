import { sql } from "drizzle-orm";
import type { Tx } from "./index.ts";

/**
 * Ob ein Datensatz die Datei im Dokumentenspeicher nutzt (Ablage nach Inhalt, also derselbe SHA-256). Belege,
 * Archivdateien, Lexoffice-Dateien, Bescheide, Rechnungsanhänge und Protokolle vermerkter Voranmeldungen teilen sich den Speicher; gelöscht wird eine Datei
 * erst, wenn keiner sie mehr braucht.
 */
export async function fileInUse(tx: Tx, sha256: string): Promise<boolean> {
  const [use] = await tx.execute<{ used: boolean }>(sql`
    select exists (select 1 from documents where sha256 = ${sha256})
        or exists (select 1 from archive_files where sha256 = ${sha256})
        or exists (select 1 from lexoffice_voucher_files where sha256 = ${sha256})
        or exists (select 1 from postfach_documents where sha256 = ${sha256})
        or exists (select 1 from invoice_attachments where sha256 = ${sha256})
        or exists (select 1 from vat_return_filings where sha256 = ${sha256}) as used`);
  return Boolean(use?.used);
}

/**
 * Sperrt die Datei bis zum Ende der Transaktion für andere, die sie ablegen oder löschen. Ohne die Sperre kann ein
 * Löschen, dessen Prüfung den gerade entstehenden Datensatz noch nicht sieht, die Datei nach dessen Commit entfernen.
 */
export async function lockFileUse(tx: Tx, sha256: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`haben-datei:${sha256}`}, 0))`);
}
