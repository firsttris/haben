import {
  BANK_CSV_FIELDS,
  type BankCsvFile,
  type BankCsvMapping,
  type ColumnMapping,
  detectStatementFormat,
  findSavedHeader,
  guessHeaderRow,
  headerOf,
  parseMappedStatement,
  readBankCsv,
  suggestBankMapping,
} from "@haben/import";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { UserError } from "../../errors.ts";
import { db, schema } from "../../db/index.ts";
import { sha256Of } from "../../storage.ts";
import { BankError, importStatement, type ImportResult, storeStatement } from "./bank.ts";

/*
 * Bank-CSV, die Haben nicht kennt, über eine Spaltenzuordnung von Hand importieren (#1275). Die Zuordnung hängt am
 * Konto: Die Datei nennt keine eigene IBAN, das Konto wird also ohnehin gewählt. Der nächste Export mit derselben
 * Kopfzeile geht ohne Rückfrage durch.
 */

/**
 * Eine CSV, die keiner bekannten Bank gehört; die Seite bietet dann die Zuordnung an. Erbt von UserError, nicht von
 * BankError: bank.ts wird über den Ring der Module erst nach dieser Datei fertig geladen.
 */
export class UnbekannteCsvError extends UserError {}

const MAX_COLUMNS = 200;
/** So viele Zeilen zeigt die Vorschau; Fehler stehen vorn */
const SHOWN_ROWS = 200;
/** Zur Auswahl der Kopfzeile, wie weit Haben selbst sucht */
const HEADER_CHOICES = 40;

export const bankCsvMappingSchema = z.object({
  header: z.array(z.string().max(500)).max(MAX_COLUMNS),
  // Fehlende Felder gelten als nicht zugeordnet
  columns: z
    .partialRecord(z.enum(BANK_CSV_FIELDS.map((f) => f.key) as [string, ...string[]]), z.number().int().min(0).max(MAX_COLUMNS).nullable())
    .transform((columns): ColumnMapping => Object.fromEntries(BANK_CSV_FIELDS.map((f) => [f.key, columns[f.key] ?? null]))),
  amountFormat: z.enum(["de", "en"]),
});

export const csvZuordnungSchema = z.object({
  accountId: z.uuid().nullable(),
  /** Index der Kopfzeile unter den nicht leeren Zeilen; ohne ihn schlägt Haben eine vor */
  headerRow: z
    .number()
    .int()
    .min(0)
    .max(HEADER_CHOICES - 1)
    .nullable(),
  mapping: bankCsvMappingSchema.nullable(),
});

function readOrFail(bytes: Uint8Array, filename: string): BankCsvFile {
  const file = readBankCsv(bytes);
  if ("error" in file) throw new BankError(`${filename}: ${file.error}`);
  return file;
}

async function savedMapping(accountId: string | null): Promise<BankCsvMapping | null> {
  if (!accountId) return null;
  const [account] = await db.select({ csvMapping: schema.bankAccounts.csvMapping }).from(schema.bankAccounts).where(eq(schema.bankAccounts.id, accountId));
  return account?.csvMapping ?? null;
}

const sameHeader = (a: readonly string[], b: readonly string[]) => a.join("\u0000") === b.join("\u0000");

/**
 * Importiert eine Kontoauszugsdatei wie `importStatement`. Kennt Haben die Bank nicht, liest es die Datei mit der am
 * Konto gespeicherten Zuordnung, wenn die Kopfzeile passt; sonst meldet `UnbekannteCsvError`, dass sich die Spalten
 * zuordnen lassen.
 */
export async function importStatementFile(actor: string, file: { bytes: Uint8Array; filename: string }, accountId: string | null): Promise<ImportResult> {
  try {
    return await importStatement(actor, file, accountId);
  } catch (error) {
    if (!(error instanceof BankError) || detectStatementFormat(file.bytes) !== null) throw error;
    const csv = readBankCsv(file.bytes);
    if ("error" in csv) throw error;
    const mapping = await savedMapping(accountId);
    const headerRow = mapping ? findSavedHeader(csv.records, mapping.header) : -1;
    if (!mapping || headerRow < 0) throw new UnbekannteCsvError(`${file.filename}: Haben kennt diese Bank nicht. Ordne die Spalten einmal selbst zu.`);
    return importMapped(actor, file, accountId!, csv, headerRow, mapping);
  }
}

async function importMapped(
  actor: string,
  file: { bytes: Uint8Array; filename: string },
  accountId: string,
  csv: BankCsvFile,
  headerRow: number,
  mapping: BankCsvMapping,
) {
  const result = parseMappedStatement(csv.records, headerRow, mapping);
  if (!result.statement) throw new BankError(`${file.filename}: ${result.problem}`);
  const statement = result.statement;
  return withActor(actor, async (tx) => {
    const imported = await storeStatement(tx, statement, { filename: file.filename, sha256: sha256Of(file.bytes), csvMapping: mapping }, accountId);
    await tx.update(schema.bankAccounts).set({ csvMapping: mapping }).where(eq(schema.bankAccounts.id, accountId));
    return imported;
  });
}

export interface CsvZuordnungVorschau {
  encoding: string;
  delimiter: string;
  headerRow: number;
  headerChoices: { index: number; line: number; text: string }[];
  fields: { key: string; label: string; hint?: string }[];
  mapping: BankCsvMapping;
  /** Die Zuordnung stammt vom Konto (gespeichert beim letzten Import) */
  saved: boolean;
  problem: string | null;
  counts: { ok: number; fehler: number };
  rows: { line: number; bookingDate: string | null; amount: number | null; counterpartyName: string; purpose: string; errors: string[] }[];
}

/**
 * Vorschau einer Zuordnung. Ohne Angaben schlägt Haben Kopfzeile und Spalten vor, oder nimmt die Zuordnung des Kontos,
 * wenn die Kopfzeile passt. Eine Zuordnung für eine andere Kopfzeile verwirft es zugunsten eines neuen Vorschlags.
 */
export async function previewCsvZuordnung(bytes: Uint8Array, filename: string, input: z.infer<typeof csvZuordnungSchema>): Promise<CsvZuordnungVorschau> {
  const csv = readOrFail(bytes, filename);
  const stored = await savedMapping(input.accountId);
  const storedRow = stored ? findSavedHeader(csv.records, stored.header) : -1;
  const headerRow = Math.min(input.headerRow ?? (storedRow >= 0 ? storedRow : guessHeaderRow(csv.records)), csv.records.length - 2);
  const header = headerOf(csv.records[headerRow]!.cells);
  const candidates = [input.mapping, storedRow === headerRow ? stored : null].filter((m): m is BankCsvMapping => m !== null && sameHeader(m.header, header));
  const mapping = candidates[0] ?? suggestBankMapping(csv.records, headerRow);
  const result = parseMappedStatement(csv.records, headerRow, mapping);
  const rows = result.rows.map((r) => ({
    line: r.line,
    bookingDate: r.transaction?.bookingDate ?? null,
    amount: r.transaction?.amount ?? null,
    counterpartyName: r.transaction?.counterpartyName ?? "",
    purpose: r.transaction?.purpose ?? "",
    errors: r.errors,
  }));
  const fehler = rows.filter((r) => r.errors.length > 0);
  return {
    encoding: csv.encoding,
    delimiter: csv.delimiter,
    headerRow,
    headerChoices: csv.records.slice(0, HEADER_CHOICES).map((r, index) => ({ index, line: r.line, text: headerOf(r.cells).join(" · ").slice(0, 120) })),
    fields: BANK_CSV_FIELDS.map((f) => ({ key: f.key, label: f.label, hint: "hint" in f ? f.hint : undefined })),
    mapping,
    saved: !input.mapping && stored !== null && storedRow === headerRow,
    problem: result.problem,
    counts: { ok: rows.length - fehler.length, fehler: fehler.length },
    rows: [...fehler, ...rows.filter((r) => r.errors.length === 0)].slice(0, SHOWN_ROWS),
  };
}

/** Importiert mit der Zuordnung aus der Vorschau und speichert sie am Konto */
export async function importCsvZuordnung(
  actor: string,
  file: { bytes: Uint8Array; filename: string },
  input: z.infer<typeof csvZuordnungSchema>,
): Promise<ImportResult> {
  if (!input.accountId) throw new BankError("Wähle das Konto, zu dem die Datei gehört.");
  if (input.headerRow === null || !input.mapping) throw new BankError("Erst die Vorschau ansehen, dann importieren.");
  const csv = readOrFail(file.bytes, file.filename);
  return importMapped(actor, file, input.accountId, csv, input.headerRow, input.mapping);
}
