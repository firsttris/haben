import {
  CSV_DELIMITER_LABEL,
  CSV_IMPORT_FIELDS,
  CSV_IMPORT_KINDS,
  CSV_ENCODING_LABEL as ENCODING,
  type CsvTable,
  isDatevStammdaten,
  parseDatevStammdaten,
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
import {
  applyDatevContactImport,
  insertImportedArticles,
  insertImportedContacts,
  planArticleImport,
  planContactImport,
  planDatevContactImport,
} from "../stammdaten/index.ts";

/*
 * CSV-Import von Kontakten, Artikeln und Anlagen (docs/csv-import.md). Vorschau und Import lesen dieselbe Datei mit
 * denselben Einstellungen; der Import plant in seiner Transaktion neu, damit zwischen Vorschau und Klick angelegte
 * Datensätze als Dubletten zählen. Übernommen werden nur neue Zeilen, alle in einer Transaktion: Scheitert eine, bleibt
 * nichts angelegt. Eine DATEV-Datei „Debitoren/Kreditoren“ (EXTF Kategorie 16) erkennt der Import am Kopf und liest sie
 * nach dem DATEV-Format statt mit Spaltenzuordnung; ihre Vorschläge an vorhandene Kontakte gelten nur, wenn `confirm`
 * ihre Zeile nennt.
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
  /** DATEV-Stammdaten: erste Zeile je bestätigtem Vorschlag, einem vorhandenen Kontakt die Nummer zu geben */
  confirm: z.array(z.int().min(1)).max(5000).default([]),
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

type PreviewStatus = "neu" | "zuordnen" | "dublette" | "fehler";
const counted = (rows: readonly { status: PreviewStatus }[]) => ({
  neu: rows.filter((r) => r.status === "neu").length,
  zuordnen: rows.filter((r) => r.status === "zuordnen").length,
  dublette: rows.filter((r) => r.status === "dublette").length,
  fehler: rows.filter((r) => r.status === "fehler").length,
});

/** DATEV-Stammdaten lesen; nur Kontakte haben Debitoren und Kreditoren */
function readDatev(bytes: Uint8Array, options: CsvImportOptions) {
  if (options.kind !== "kontakte") throw new CsvImportError("Das ist eine DATEV-Datei „Debitoren/Kreditoren“; sie gehört zu den Kontakten.");
  const result = parseDatevStammdaten(bytes, options.encoding);
  if (!result.ok) throw new CsvImportError(result.error);
  return result;
}

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
  if (isDatevStammdaten(bytes)) {
    const parsed = readDatev(bytes, options);
    const rows = await planDatevContactImport(db, parsed.rows);
    return {
      kind: options.kind,
      source: "datev" as "csv" | "datev",
      encoding: ENCODING[parsed.encoding],
      delimiter: CSV_DELIMITER_LABEL[";"],
      header: [] as string[],
      fields: [] as { key: string; label: string; hint: string | null }[],
      mapping: {} as ColumnMapping,
      problem: null as string | null,
      counts: counted(rows) as ReturnType<typeof planCounts> & { zuordnen?: number },
      rows: rows.map(({ line, lines, title, status, message }) => ({ line, lines, title, status: status as PreviewStatus, message })),
    };
  }
  const table = readTable(bytes, options);
  const mapping = mappingFor(table, options);
  const { rows, problem } = await plan(db, table, mapping, options);
  return {
    kind: options.kind,
    source: "csv" as "csv" | "datev",
    encoding: ENCODING[table.encoding],
    delimiter: CSV_DELIMITER_LABEL[table.delimiter],
    header: table.header,
    fields: CSV_IMPORT_FIELDS[options.kind].map(({ key, label, hint }) => ({ key, label, hint: hint ?? null })),
    mapping,
    problem,
    counts: planCounts(rows) as ReturnType<typeof planCounts> & { zuordnen?: number },
    rows: rows.map(({ line, title, status, message }) => ({ line, lines: [line], title, status: status as PreviewStatus, message })),
  };
}

export type CsvImportPreview = Awaited<ReturnType<typeof previewCsvImport>>;

export interface CsvImportResult {
  created: number;
  duplicates: number;
  failed: number;
  /** Nur DATEV-Stammdaten: bestätigte und nicht bestätigte Vorschläge an vorhandene Kontakte */
  assigned?: number;
  unconfirmed?: number;
}

const NOTHING = "Nichts zu übernehmen: Alle Zeilen sind Dubletten oder fehlerhaft.";

export async function runCsvImport(actor: string, bytes: Uint8Array, options: CsvImportOptions): Promise<CsvImportResult> {
  if (isDatevStammdaten(bytes)) return runDatevImport(actor, bytes, options);
  const table = readTable(bytes, options);
  const mapping = mappingFor(table, options);
  return withActor(actor, async (tx) => {
    await lock(tx);
    const { rows, problem, insert } = await plan(tx, table, mapping, options);
    if (problem) throw new CsvImportError(problem);
    const counts = planCounts(rows);
    if (counts.neu === 0) throw new CsvImportError(NOTHING);
    const created = await insert(tx);
    return { created, duplicates: counts.dublette, failed: counts.fehler };
  });
}

/** Zwei gleichzeitige Importe sähen die Zeilen des anderen nicht und legten sie doppelt an */
const lock = (tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('haben.csv-import'))`);

async function runDatevImport(actor: string, bytes: Uint8Array, options: CsvImportOptions): Promise<CsvImportResult> {
  const parsed = readDatev(bytes, options);
  const confirmed = new Set(options.confirm);
  return withActor(actor, async (tx) => {
    await lock(tx);
    const rows = await planDatevContactImport(tx, parsed.rows);
    const counts = counted(rows);
    const confirmedCount = rows.filter((r) => r.status === "zuordnen" && confirmed.has(r.line)).length;
    if (counts.neu + confirmedCount === 0)
      throw new CsvImportError(counts.zuordnen > 0 ? "Nichts zu übernehmen: Bestätige einen Vorschlag oder lade eine andere Datei." : NOTHING);
    const { created, assigned } = await applyDatevContactImport(tx, rows, confirmed);
    return { created, assigned, duplicates: counts.dublette, failed: counts.fehler, unconfirmed: counts.zuordnen - assigned };
  });
}
