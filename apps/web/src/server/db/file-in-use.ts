import { sql } from "drizzle-orm";
import type { Tx } from "./index.ts";

/** Eine Spalte, deren SHA-256 auf eine Datei im Dokumentenspeicher zeigt, mit dem Dateinamen des Datensatzes */
export interface FileReference {
  table: string;
  column: string;
  nameColumn: string;
  /** Was die Datei ist, für Befunde in „Kette prüfen“ und der Wochenmail */
  label: string;
}

/**
 * Alle Verweise auf Dateien im Dokumentenspeicher (Ablage nach Inhalt, also derselbe SHA-256 für dieselbe Datei).
 * fileInUse und die Vollprüfung der Dateien lesen von hier; der Test-Restore (deploy/backup/restore-check.sh) hat eine
 * Kopie, die restore-check.test.ts vergleicht. file-in-use.test.ts vergleicht die Liste mit allen SHA-256-Spalten im Schema.
 */
export const FILE_REFERENCES: readonly FileReference[] = [
  { table: "documents", column: "sha256", nameColumn: "filename", label: "Beleg" },
  { table: "archive_files", column: "sha256", nameColumn: "filename", label: "Archivdatei" },
  { table: "lexoffice_voucher_files", column: "sha256", nameColumn: "filename", label: "Datei aus dem Umzug" },
  { table: "legacy_order_files", column: "sha256", nameColumn: "filename", label: "Auftrags-PDF aus dem Umzug" },
  { table: "postfach_documents", column: "sha256", nameColumn: "filename", label: "Bescheid aus dem Postfach" },
  { table: "invoice_attachments", column: "sha256", nameColumn: "filename", label: "Anhang einer Rechnung" },
  { table: "quote_attachments", column: "sha256", nameColumn: "filename", label: "Anhang eines Angebots" },
  { table: "quote_default_attachments", column: "sha256", nameColumn: "filename", label: "Standardanhang der Angebote" },
  { table: "vat_return_filings", column: "sha256", nameColumn: "filename", label: "Protokoll einer Voranmeldung" },
  { table: "sv_portal_filings", column: "protokoll_sha256", nameColumn: "protokoll_dateiname", label: "Protokoll aus dem SV-Meldeportal" },
  { table: "recurring_documents", column: "sha256", nameColumn: "filename", label: "Vertrag eines Dauerbelegs" },
  { table: "sepa_mandate_files", column: "sha256", nameColumn: "filename", label: "Lastschriftmandat" },
];

/** Ob ein Datensatz die Datei nutzt; gelöscht wird eine Datei erst, wenn keiner sie mehr braucht. */
export async function fileInUse(tx: Tx, sha256: string): Promise<boolean> {
  const uses = FILE_REFERENCES.map((r) => sql`exists (select 1 from ${sql.identifier(r.table)} where ${sql.identifier(r.column)} = ${sha256})`);
  const [use] = await tx.execute<{ used: boolean }>(sql`select ${sql.join(uses, sql` or `)} as used`);
  return Boolean(use?.used);
}

/**
 * Sperrt die Datei bis zum Ende der Transaktion für andere, die sie ablegen oder löschen. Ohne die Sperre kann ein
 * Löschen, dessen Prüfung den gerade entstehenden Datensatz noch nicht sieht, die Datei nach dessen Commit entfernen.
 */
export async function lockFileUse(tx: Tx, sha256: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`haben-datei:${sha256}`}, 0))`);
}
