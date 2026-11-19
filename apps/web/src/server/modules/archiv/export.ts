import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { today } from "../../today.ts";
import { refreshOwnAccountNames } from "../eigene-konten/index.ts";
import { procedureMarkdown } from "../verfahrensdoku/index.ts";
import { mitIndexXml } from "./beschreibung.ts";
import { csv } from "./csv.ts";
import { auditCsv, pruefwertText } from "./export-audit.ts";
import { bankFiles } from "./export-bank.ts";
import { bookingFiles } from "./export-bookings.ts";
import { documentFiles } from "./export-documents.ts";
import { invoiceFiles, quoteFiles } from "./export-invoices.ts";
import { legacyFiles, orderFiles } from "./export-legacy.ts";
import { masterDataFiles } from "./export-master-data.ts";
import { HABEN_VERSION, readme } from "./export-readme.ts";
import { vatFiles } from "./export-vat.ts";
import { type ArchiveFile, zipArchive } from "./export-zip.ts";
import { externalImportArchive } from "./external-import-archive.ts";
import { dunningFiles } from "./mahnungen-export.ts";
import { VERSIONEN_HEADER, versionenFuerArchiv } from "./versionen.ts";
import { vatReportFiles } from "./voranmeldungen-export.ts";

/**
 * Jahresarchiv als ZIP: alle Rechnungen, Belege, Buchungen, Bankumsätze, Voranmeldungen,
 * Stammdaten und das Änderungsprotokoll eines Kalenderjahrs für die Aufbewahrung.
 *
 * Das ZIP wird mit fflate Datei für Datei erzeugt und als Stream ausgeliefert: Es liegt immer
 * höchstens eine Datei im Speicher, und der nächste Beleg wird erst gelesen, wenn der Client
 * den vorigen abgenommen hat. Das ELSTER-Zertifikat gehört nie ins Archiv.
 *
 * Die Teile des Archivs stehen in eigenen Dateien (export-*.ts); diese Datei setzt sie in der Reihenfolge des Archivs
 * zusammen.
 */

const encoder = new TextEncoder();

/** Das ZIP-Archiv eines Kalenderjahrs als Byte-Stücke */
export function exportYear(year: number, now = new Date()): AsyncGenerator<Uint8Array> {
  return zipArchive(withIndex(withProcedure(yearFiles(year, now), now), year), now);
}

/** Hängt die Verfahrensdokumentation in der Fassung beim Erstellen des Archivs an (#860, GoBD Rz. 154), wie unter Einstellungen › Export */
async function* withProcedure(files: AsyncIterable<ArchiveFile>, now: Date): AsyncGenerator<ArchiveFile> {
  yield* files;
  yield { path: "verfahrensdokumentation.md", content: encoder.encode(await procedureMarkdown(now)), compress: true };
}

/** Hängt die index.xml (Beschreibungsstandard der Finanzverwaltung, #546) hinter die Dateien des Jahres */
async function* withIndex(files: AsyncIterable<ArchiveFile>, year: number): AsyncGenerator<ArchiveFile> {
  const [company] = await db.select({ name: schema.company.name, ort: schema.company.ort }).from(schema.company).where(eq(schema.company.id, 1));
  yield* mitIndexXml(files, { name: company?.name || "–", ort: company?.ort || "–", jahr: year, version: HABEN_VERSION });
}

export function exportFilename(year: number, now = new Date()): string {
  return `Haben-${year}-${today(now)}.zip`;
}

/** Jahre mit Daten, absteigend; das laufende und das vorige Jahr sind immer dabei. */
export async function exportYears(now = new Date()): Promise<number[]> {
  const rows = await db.execute<{ y: number }>(sql`
    select extract(year from issue_date)::int as y from invoices where status = 'final'
    union select extract(year from coalesce(document_date, (uploaded_at at time zone 'Europe/Berlin')::date))::int from documents
    union select extract(year from date)::int from journal_entries
    union select extract(year from booking_date)::int from bank_transactions where bank_account_id not in (select id from bank_accounts where excluded_at is not null)
    union select year::int from vat_returns
    union select extract(year from date)::int from lexoffice_vouchers
    union select extract(year from date)::int from legacy_order_documents
    union select extract(year from date)::int from datev_bookings
    union select year::int from legacy_vat_reports
    union select year::int from archive_files where year is not null`);
  const current = Number(today(now).slice(0, 4));
  const years = new Set([current, current - 1, ...rows.map((r) => Number(r.y))]);
  return [...years].sort((a, b) => b - a);
}

async function* yearFiles(year: number, now: Date): AsyncGenerator<ArchiveFile> {
  const [company] = await db.select().from(schema.company).where(eq(schema.company.id, 1));
  const problems: string[] = [];
  await refreshOwnAccountNames();

  yield { path: "LIESMICH.txt", content: encoder.encode(readme(year, now, company)), compress: true };
  yield* externalImportArchive(year);

  const invoiceNumbers = yield* invoiceFiles(year, problems);
  yield* quoteFiles(year, problems);
  const documentPaths = yield* documentFiles(year, company, problems, invoiceNumbers);
  yield* bookingFiles(year);
  const accounts = yield* bankFiles(year, invoiceNumbers, documentPaths);
  yield* vatFiles(year, problems);

  // Altbestand aus Lexoffice und sevDesk ----------------------------------------
  yield* legacyFiles(year, problems);
  yield* orderFiles(year, problems);
  yield* dunningFiles(year, problems);
  yield* await vatReportFiles(year, problems);

  // Stammdaten ------------------------------------------------------------
  yield* masterDataFiles(year, company, accounts);

  // Änderungsprotokoll, seitenweise gelesen ----------------------------------
  yield { path: "protokoll/audit.csv", content: auditCsv(year), compress: true };
  yield { path: "protokoll/pruefwert.txt", content: encoder.encode(await pruefwertText(year, now)), compress: true };
  yield { path: "protokoll/versionen.csv", content: csv(VERSIONEN_HEADER, await versionenFuerArchiv(year)), compress: true };

  if (problems.length > 0) {
    yield { path: "FEHLER.txt", content: encoder.encode(`Beim Erstellen des Archivs fehlten Dateien:\n\n${problems.join("\n")}\n`), compress: true };
  }
}
