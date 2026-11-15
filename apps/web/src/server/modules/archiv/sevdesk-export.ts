import { readSevdeskExport, type SevExport } from "@haben/import";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { LexofficeImportProgress, SevdeskExportProgress } from "../../db/schema.ts";
import { isUniqueViolation, UserError } from "../../errors.ts";
import { sha256Of } from "../../storage.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { latestAccountableImport } from "./accountable.ts";
import { latestFastbillImport } from "./fastbill.ts";
import { finish, latestImport, progressMessage, STALE_MS } from "./lexoffice.ts";
import { latestSevdeskImport } from "./sevdesk.ts";
import { runSevdeskExportImport } from "./sevdesk-export-lauf.ts";

/*
 * Umzug aus sevDesk ohne API (#1105): Die Export-ZIP „Buchungsdaten & Belegbilder“ (Steuern › Mein Steuerberater) wird
 * hochgeladen, analysiert und auf Knopfdruck übernommen, nach dem Muster des Accountable-Umzugs. Den Inhalt liest
 * readSevdeskExport in @haben/import; den Lauf beschreibt sevdesk-export-lauf.ts.
 *
 * Analyse und Vorschau lesen nur: Was der Lauf anlegen wird, was schon im Archiv liegt (ZIP oder Stapel auf dem früheren
 * Weg über „Sonstiges“ und „DATEV-Buchungsstapel“) und welche Jahre schon Belege aus der API haben.
 */

export class SevdeskExportError extends UserError {}

/** Wie beim Archiv (MAX_ARCHIVE_SIZE): Größere Exporte teilt man in kürzere Zeiträume */
export const MAX_SEVDESK_EXPORT_SIZE = 100 * 1024 * 1024;

const SOURCE = "sevdesk-export" as const;
const HINT_LIMIT = 50;

export interface StagedSevdeskExport {
  filename: string;
  bytes: Uint8Array;
  export: SevExport;
  analysis: SevdeskExportProgress;
}

// Nur im Speicher: Ein Upload legt nichts an, erst der Lauf. Ein neuer Upload ersetzt den vorigen.
let staged: StagedSevdeskExport | null = null;
export const stagedSevdeskExport = () => staged;

/** Läufe, die gerade im Prozess laufen; nach einem Neustart des Servers gelten sie als abgebrochen */
const running = new Set<string>();
const cancelledSevdeskExport = new Set<string>();

/** Jahre mit Belegen aus der API von sevDesk */
export async function sevdeskApiYears(): Promise<number[]> {
  const rows = await db.execute<{ year: number }>(
    sql`select distinct extract(year from date)::int as year from lexoffice_vouchers where source = 'sevdesk' order by 1`,
  );
  return [...rows].map((r) => Number(r.year));
}

/** Je Stapel: schon im Archiv, Zeitraum von einem anderen Stapel belegt, oder neu */
async function stackStates(exp: SevExport): Promise<SevdeskExportProgress["stacks"]> {
  const result: SevdeskExportProgress["stacks"] = [];
  for (const { name, bytes, stack } of exp.stacks) {
    const dates = stack.bookings.map((b) => b.date).sort();
    const from = dates[0] ?? stack.header.dateFrom ?? "";
    const to = dates.at(-1) ?? stack.header.dateTo ?? "";
    const [same] = await db
      .select({ id: schema.archiveFiles.id })
      .from(schema.archiveFiles)
      .where(eq(schema.archiveFiles.sha256, sha256Of(bytes)));
    if (same) {
      result.push({ name, from, to, state: "vorhanden" });
      continue;
    }
    const [overlap] = await db
      .select({ filename: schema.archiveFiles.filename })
      .from(schema.archiveFiles)
      .where(
        and(
          eq(schema.archiveFiles.kind, "datev"),
          sql`${schema.archiveFiles.meta} ->> 'dateFrom' <= ${to}`,
          sql`${schema.archiveFiles.meta} ->> 'dateTo' >= ${from}`,
        ),
      )
      .limit(1);
    result.push(overlap ? { name, from, to, state: "zeitraum", other: overlap.filename } : { name, from, to, state: "neu" });
  }
  return result;
}

/** Was der Upload enthält und was der Lauf damit macht; liest nur. */
async function analysisOf(bytes: Uint8Array, filename: string, exp: SevExport): Promise<SevdeskExportProgress> {
  const apiYears = await sevdeskApiYears();
  const [zip] = await db
    .select({ id: schema.archiveFiles.id })
    .from(schema.archiveFiles)
    .where(eq(schema.archiveFiles.sha256, sha256Of(bytes)));
  const v = exp.vouchers;
  return {
    filename,
    size: bytes.byteLength,
    years: [...new Set(v.map((x) => Number(x.date.slice(0, 4))))].sort(),
    bookings: exp.stacks.reduce((sum, s) => sum + s.stack.bookings.length, 0),
    vouchers: v.length,
    withFile: v.filter((x) => x.guid !== null && exp.files.has(x.guid)).length,
    missingFile: v.filter((x) => x.guid !== null && !exp.files.has(x.guid)).length,
    withoutImage: v.filter((x) => x.guid === null).length,
    otherAccounts: v.filter((x) => x.accountKind === null).length,
    apiYears,
    inApiYears: v.filter((x) => apiYears.includes(Number(x.date.slice(0, 4)))).length,
    zipArchived: Boolean(zip),
    stacks: await stackStates(exp),
    hints: exp.hints.slice(0, HINT_LIMIT),
    hintCount: exp.hints.length,
  };
}

/**
 * Prüft den Upload und legt ihn zum Starten in den Speicher. Wirft SevdeskExportError mit dem Grund, wenn die Datei
 * nicht der Export von sevDesk ist; dann ist nichts angelegt.
 */
export async function analyseSevdeskExport(bytes: Uint8Array, filename: string): Promise<SevdeskExportProgress> {
  // Ein abgelehnter Upload darf den vorigen nicht startbar lassen: „Übernehmen“ nähme sonst die falsche Datei
  staged = null;
  if (bytes.byteLength === 0) throw new SevdeskExportError("Die Datei ist leer.");
  if (bytes.byteLength > MAX_SEVDESK_EXPORT_SIZE) throw new SevdeskExportError("Die Datei ist größer als 100 MB. Exportiere kürzere Zeiträume.");
  const { kontenrahmen } = await loadCompany();
  const result = readSevdeskExport(bytes, { kontenrahmen });
  if (!result.ok) throw new SevdeskExportError(result.reason);
  if (result.export.vouchers.length === 0 && result.export.stacks.every((s) => s.stack.bookings.length === 0)) {
    throw new SevdeskExportError("Der Export enthält keine Buchungen.");
  }
  const analysis = await analysisOf(bytes, filename, result.export);
  staged = { filename, bytes, export: result.export, analysis };
  return analysis;
}

export type SevdeskExportRun = typeof schema.lexofficeImports.$inferSelect & { sevdeskExport: SevdeskExportProgress | null };

const runOf = (row: typeof schema.lexofficeImports.$inferSelect): SevdeskExportRun => ({ ...row, sevdeskExport: row.progress.sevdeskExport ?? null });

/** Letzter Lauf mit der Export-ZIP; ein hängengebliebener (Server neu gestartet) gilt als abgebrochen. */
export async function latestSevdeskExportImport(): Promise<SevdeskExportRun | null> {
  const [row] = await db
    .select()
    .from(schema.lexofficeImports)
    .where(eq(schema.lexofficeImports.source, SOURCE))
    .orderBy(desc(schema.lexofficeImports.startedAt))
    .limit(1);
  if (!row) return null;
  if (row.status === "laeuft" && !running.has(row.id) && Date.now() - row.updatedAt.getTime() > STALE_MS) {
    const [updated] = await db
      .update(schema.lexofficeImports)
      .set({ status: "abgebrochen", error: "Der Lauf wurde unterbrochen. Lade den Export erneut hoch.", finishedAt: new Date() })
      .where(and(eq(schema.lexofficeImports.id, row.id), eq(schema.lexofficeImports.status, "laeuft")))
      .returning();
    return runOf(updated ?? row);
  }
  return runOf(row);
}

export async function sevdeskExportImportStatus(id: string): Promise<SevdeskExportRun | null> {
  const [row] = await db
    .select()
    .from(schema.lexofficeImports)
    .where(and(eq(schema.lexofficeImports.id, id), inArray(schema.lexofficeImports.source, [SOURCE])));
  return row ? runOf(row) : null;
}

/** Startet den Lauf für den hochgeladenen Export im Hintergrund; ein zweiter Lauf überspringt, was schon liegt. */
export async function startSevdeskExportImport(actor: string, options: { wait?: boolean } = {}): Promise<string> {
  const upload = staged;
  if (!upload) throw new SevdeskExportError("Zuerst den Export hochladen.");
  // Der eindeutige Index gilt über alle Quellen: verwaiste Läufe anderer Quellen als abgebrochen markieren
  await latestImport();
  await latestSevdeskImport();
  await latestFastbillImport();
  await latestAccountableImport();
  await latestSevdeskExportImport();
  const progress: LexofficeImportProgress = {
    phase: "belege",
    contacts: 0,
    contactsLinked: 0,
    listed: upload.export.vouchers.length,
    imported: 0,
    skipped: 0,
    files: 0,
    failed: [],
    sevdeskExport: { ...upload.analysis },
  };
  const [row] = await withActor(actor, (tx) =>
    tx.insert(schema.lexofficeImports).values({ source: SOURCE, progress }).returning({ id: schema.lexofficeImports.id }),
  ).catch((error: unknown) => {
    if (isUniqueViolation(error, "lexoffice_imports_one_running")) throw new SevdeskExportError("Ein Abruf läuft bereits.");
    throw error;
  });
  const id = row!.id;
  running.add(id);
  cancelledSevdeskExport.delete(id);
  // Eine Transaktion je Lauf, wie bei Accountable: Scheitert er, ist nichts angelegt, und ein neuer Lauf nimmt alles mit
  const job = withActor(actor, (tx) => runSevdeskExportImport(tx, id, upload, progress, () => cancelledSevdeskExport.has(id)))
    .then(() => finish(id, progress, "fertig", null))
    .catch((error: unknown) => {
      const stopped = cancelledSevdeskExport.has(id);
      return finish(id, progress, stopped ? "abgebrochen" : "fehler", stopped ? "Abgebrochen." : progressMessage(error));
    })
    .catch((error: unknown) => console.error("sevDesk-Export: Abschluss nicht gespeichert", error))
    .finally(() => {
      running.delete(id);
      cancelledSevdeskExport.delete(id);
    });
  if (options.wait) await job;
  return id;
}

export function cancelSevdeskExportImport(id: string): boolean {
  if (!running.has(id)) return false;
  cancelledSevdeskExport.add(id);
  return true;
}
