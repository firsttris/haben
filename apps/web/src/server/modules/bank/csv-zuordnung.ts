import {
  BANK_CSV_FIELDS,
  type BankCsvFile,
  type BankCsvMapping,
  type ColumnMapping,
  detectStatementFormat,
  findSavedHeader,
  parseMappedStatement,
  readBankCsv,
  sameMapping,
} from "@haben/import";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { sha256Of } from "../../storage.ts";
import { BankError } from "./bank-error.ts";
import { importStatement, type ImportResult, storeStatement, UnbekannteCsvError } from "./statement-import.ts";

/*
 * Bank-CSV, die Haben nicht kennt, über eine Spaltenzuordnung von Hand importieren (#1275). Die Zuordnung hängt am
 * Konto: Die Datei nennt keine eigene IBAN, das Konto wird also ohnehin gewählt. Der nächste Export mit derselben
 * Kopfzeile geht ohne Rückfrage durch.
 */

const MAX_COLUMNS = 200;
/** Wie weit Haben die Kopfzeile sucht (findHeaderRow, guessHeaderRow) */
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
  /** Index der Kopfzeile unter den nicht leeren Zeilen */
  headerRow: z
    .number()
    .int()
    .min(0)
    .max(HEADER_CHOICES - 1),
  mapping: bankCsvMappingSchema,
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

/** Ergebnis eines Imports; `mitZuordnung`: gelesen mit der Zuordnung am Konto, `zuordnungGespeichert`: sie ist neu oder geändert */
export type CsvImportResult = ImportResult & { mitZuordnung: boolean; zuordnungGespeichert: boolean };

/**
 * Importiert eine Kontoauszugsdatei wie `importStatement`. Kennt Haben die Bank nicht, liest es die Datei mit der am
 * Konto gespeicherten Zuordnung, wenn die Kopfzeile passt; sonst meldet `UnbekannteCsvError`, dass sich die Spalten
 * zuordnen lassen.
 */
export async function importStatementFile(actor: string, file: { bytes: Uint8Array; filename: string }, accountId: string | null): Promise<CsvImportResult> {
  try {
    return { ...(await importStatement(actor, file, accountId)), mitZuordnung: false, zuordnungGespeichert: false };
  } catch (error) {
    if (!(error instanceof BankError) || detectStatementFormat(file.bytes) !== null) throw error;
    const csv = readBankCsv(file.bytes);
    if ("error" in csv) throw error;
    const mapping = await savedMapping(accountId);
    const headerRow = mapping ? findSavedHeader(csv.records, mapping.header) : -1;
    if (!mapping || headerRow < 0) throw new UnbekannteCsvError(`${file.filename}: Haben kennt diese Bank nicht. Ordne die Spalten einmal selbst zu.`);
    // Ergibt mit der gespeicherten Zuordnung keine Zeile einen Umsatz, hilft nur eine neue: wieder anbieten
    const problem = parseMappedStatement(csv.records, headerRow, mapping).problem;
    if (problem) throw new UnbekannteCsvError(`${file.filename}: ${problem}`);
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
): Promise<CsvImportResult> {
  const result = parseMappedStatement(csv.records, headerRow, mapping);
  if (!result.statement) throw new BankError(`${file.filename}: ${result.problem}`);
  const statement = result.statement;
  return withActor(actor, async (tx) => {
    const imported = await storeStatement(tx, statement, { filename: file.filename, sha256: sha256Of(file.bytes), csvMapping: mapping }, accountId);
    // Nur eine neue oder geänderte Zuordnung schreiben: jedes UPDATE steht im Änderungsprotokoll
    const [account] = await tx.select({ csvMapping: schema.bankAccounts.csvMapping }).from(schema.bankAccounts).where(eq(schema.bankAccounts.id, accountId));
    const changed = !account?.csvMapping || !sameMapping(account.csvMapping, mapping);
    if (changed) await tx.update(schema.bankAccounts).set({ csvMapping: mapping }).where(eq(schema.bankAccounts.id, accountId));
    return { ...imported, mitZuordnung: true, zuordnungGespeichert: changed };
  });
}

/** Importiert mit der Zuordnung aus der Vorschau (im Browser gerechnet, mit demselben Parser) und speichert sie am Konto */
export async function importCsvZuordnung(
  actor: string,
  file: { bytes: Uint8Array; filename: string },
  input: z.infer<typeof csvZuordnungSchema>,
): Promise<CsvImportResult> {
  if (!input.accountId) throw new BankError("Wähle das Konto, zu dem die Datei gehört.");
  // Eine Datei mit eigenem Parser nie über eine Zuordnung, sonst fehlten dessen Prüfungen (etwa die IBAN des Kontos)
  if (detectStatementFormat(file.bytes) !== null) throw new BankError(`${file.filename}: Haben kennt das Format dieser Datei; importiere sie ohne Zuordnung.`);
  const csv = readOrFail(file.bytes, file.filename);
  return importMapped(actor, file, input.accountId, csv, input.headerRow, input.mapping);
}
