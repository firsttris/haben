import {
  CSV_DELIMITER_LABEL,
  CSV_ENCODING_LABEL,
  CSV_IMPORT_FIELDS,
  CSV_IMPORT_KINDS,
  type CsvTable,
  type ColumnMapping,
  mappingProblem,
  planCounts,
  type PlannedRow,
  readCsvTable,
  suggestMapping,
} from "@haben/import";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { assetImportStichtagProblem, insertImportedAssets, planAssetImport } from "../buchhaltung/index.ts";
import { insertImportedArticles, insertImportedContacts, planArticleImport, planContactImport } from "../stammdaten/index.ts";

/*
 * CSV-Import von Kontakten, Artikeln und Anlagen (docs/csv-import.md). Vorschau und Import lesen dieselbe Datei mit
 * denselben Einstellungen; der Import plant in seiner Transaktion neu, damit zwischen Vorschau und Klick angelegte
 * Datensätze als Dubletten zählen. Übernommen werden nur neue Zeilen, alle in einer Transaktion: Scheitert eine, bleibt
 * nichts angelegt.
 */

export class CsvImportError extends UserError {}

export const csvImportOptionsSchema = z.object({
  kind: z.enum(CSV_IMPORT_KINDS),
  encoding: z.enum(["auto", "utf-8", "windows-1252"]).default("auto"),
  delimiter: z.enum(["auto", ";", ",", "\t"]).default("auto"),
  /** Feld → Spalte; null = Vorschlag nach Spaltennamen */
  mapping: z.record(z.string(), z.int().min(0).nullable()).nullable().default(null),
  /** Übernahmestichtag, nur für Anlagen */
  stichtag: z.iso.date().nullable().default(null),
});

export type CsvImportOptions = z.output<typeof csvImportOptionsSchema>;

function readTable(bytes: Uint8Array, options: CsvImportOptions): CsvTable {
  const result = readCsvTable(bytes, options);
  if (!result.ok) throw new CsvImportError(result.error);
  return result.table;
}

function mappingFor(table: CsvTable, options: CsvImportOptions): ColumnMapping {
  const fields = CSV_IMPORT_FIELDS[options.kind];
  if (!options.mapping) return suggestMapping(table.header, fields);
  const mapping = Object.fromEntries(fields.map((f) => [f.key, options.mapping?.[f.key] ?? null]));
  const problem = mappingProblem(mapping, table.header, fields);
  if (problem) throw new CsvImportError(`${problem}.`);
  return mapping;
}

/** Was neu angelegt wird */
const fresh = <T>(rows: readonly PlannedRow<T>[]): T[] => rows.flatMap((r) => (r.status === "neu" ? [r.value] : []));

/**
 * Plan je Art: die Zeilen, `problem` sperrt den ganzen Import (etwa ein Stichtag in einem gebuchten Jahr), `insert`
 * legt die neuen Zeilen in der Transaktion an.
 */
async function plan(
  q: Db | Tx,
  table: CsvTable,
  mapping: ColumnMapping,
  options: CsvImportOptions,
): Promise<{ rows: PlannedRow<unknown>[]; problem: string | null; insert: (tx: Tx) => Promise<number> }> {
  if (options.kind === "kontakte") {
    const rows = await planContactImport(q, table, mapping);
    return { rows, problem: null, insert: (tx) => insertImportedContacts(tx, fresh(rows)) };
  }
  if (options.kind === "artikel") {
    const rows = await planArticleImport(q, table, mapping);
    return { rows, problem: null, insert: (tx) => insertImportedArticles(tx, fresh(rows)) };
  }
  if (!options.stichtag) throw new CsvImportError("Für Anlagen fehlt der Übernahmestichtag.");
  const rows = await planAssetImport(q, table, mapping, options.stichtag);
  return { rows, problem: await assetImportStichtagProblem(q, options.stichtag), insert: (tx) => insertImportedAssets(tx, fresh(rows)) };
}

export async function previewCsvImport(bytes: Uint8Array, options: CsvImportOptions) {
  const table = readTable(bytes, options);
  const mapping = mappingFor(table, options);
  const { rows, problem } = await plan(db, table, mapping, options);
  return {
    kind: options.kind,
    encoding: CSV_ENCODING_LABEL[table.encoding],
    delimiter: CSV_DELIMITER_LABEL[table.delimiter],
    header: table.header,
    fields: CSV_IMPORT_FIELDS[options.kind].map(({ key, label, hint }) => ({ key, label, hint: hint ?? null })),
    mapping,
    problem,
    counts: planCounts(rows),
    rows: rows.map(({ line, title, status, message }) => ({ line, title, status, message })),
  };
}

export type CsvImportPreview = Awaited<ReturnType<typeof previewCsvImport>>;

export async function runCsvImport(
  actor: string,
  bytes: Uint8Array,
  options: CsvImportOptions,
): Promise<{ created: number; duplicates: number; failed: number }> {
  const table = readTable(bytes, options);
  const mapping = mappingFor(table, options);
  return withActor(actor, async (tx) => {
    // Zwei gleichzeitige Importe sähen die Zeilen des anderen nicht und legten sie doppelt an
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('haben.csv-import'))`);
    const { rows, problem, insert } = await plan(tx, table, mapping, options);
    if (problem) throw new CsvImportError(problem);
    const counts = planCounts(rows);
    if (counts.neu === 0) throw new CsvImportError("Nichts zu übernehmen: Alle Zeilen sind Dubletten oder fehlerhaft.");
    const created = await insert(tx);
    return { created, duplicates: counts.dublette, failed: counts.fehler };
  });
}
