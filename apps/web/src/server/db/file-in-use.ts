import { sql } from "drizzle-orm";
import type { Tx } from "./index.ts";

/**
 * Ob ein Datensatz die Datei im Dokumentenspeicher nutzt (Ablage nach Inhalt, also derselbe SHA-256). Belege,
 * Archivdateien, Lexoffice-Dateien, Bescheide und Rechnungsanhänge teilen sich den Speicher; gelöscht wird eine Datei
 * erst, wenn keiner sie mehr braucht.
 */
export async function fileInUse(tx: Tx, sha256: string): Promise<boolean> {
  const [use] = await tx.execute<{ used: boolean }>(sql`
    select exists (select 1 from documents where sha256 = ${sha256})
        or exists (select 1 from archive_files where sha256 = ${sha256})
        or exists (select 1 from lexoffice_voucher_files where sha256 = ${sha256})
        or exists (select 1 from postfach_documents where sha256 = ${sha256})
        or exists (select 1 from invoice_attachments where sha256 = ${sha256}) as used`);
  return Boolean(use?.used);
}
