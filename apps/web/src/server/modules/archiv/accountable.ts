import { isUniqueViolation } from "../../errors.ts";
import { type AccountableExport, type AccountableMapping, mapAccountableExport, readAccountableExport } from "@haben/import";
import { and, desc, eq, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { finish, latestImport, progressMessage, STALE_MS } from "./lexoffice.ts";
import { latestSevdeskImport } from "./sevdesk.ts";
import { runAccountableImport } from "./accountable-import.ts";
import { AccountableError, type AccountableAnalysis, cancelled, MAX_ACCOUNTABLE_SIZE, running, stageExport, stagedExport } from "./accountable-state.ts";

/*
 * Umzug aus Accountable nach dem Muster des sevDesk-Imports.
 *
 * Accountable hat keine API: Jedes Geschäftsjahr kommt als ZIP des DATEV-Exports (`Accountable_<Name>_skr03_<Datum>_…zip`)
 * mit dem Buchungsstapel, `Belege.zip` und den PDFs. Der Leser steckt in @haben/import (readAccountableExport,
 * mapAccountableExport); der Lauf selbst steht in accountable-import.ts.
 *
 * Ablage: Die Buchungen kommen wie bei Lexoffice und sevDesk in lexoffice_vouchers (source = "accountable"), der Export selbst
 * als archive_files (kind = "datev"). Damit behandeln Abgleich, offene Posten, Altbelege und Jahresexport die Quelle gleich
 * (listLegacyVouchers, legacyVoucherDetail, openLegacyItems lesen lexoffice_vouchers), und der Stapel, den du in Schritt 4
 * ohnehin ablegst, ist derselbe: eine zweite Kopie entsteht nicht, die sha256 findet den Accountable-Export im Archiv.
 *
 * Kategorie und Zahlungsstatus kommen aus `Daten.xlsx` (Sheet „Ausgaben“), wenn der Export sie mitbringt: der Buchungscode
 * nennt die Kategorie feiner als das Gegenkonto, Spalte Q/R sagt, ob bezahlt ist. Fehlt die Datei, gilt wie bisher das
 * Gegenkonto und der Beleg als bezahlt, weil der Stapel zahlungsbasiert über 1200 bucht.
 */

export { AccountableError, type AccountableAnalysis, MAX_ACCOUNTABLE_SIZE } from "./accountable-state.ts";

/** Was die Analyse ermittelt; so steht es am Lauf, ohne dass die Oberfläche neu entpacken muss. */
function analysisOf(bytes: Uint8Array, filename: string, exp: AccountableExport, mapping: AccountableMapping): AccountableAnalysis {
  const withFile = mapping.vouchers.filter((v) => v.guid !== null && exp.receiptByGuid.has(v.guid)).length;
  return {
    filename,
    size: bytes.byteLength,
    year: exp.stack.header.dateFrom ? Number(exp.stack.header.dateFrom.slice(0, 4)) : null,
    bookings: exp.stack.bookings.length,
    vouchers: mapping.vouchers.length,
    withFile,
    withoutFile: mapping.vouchers.length - withFile,
    privateRows: mapping.privateRows,
    missingReceipts: mapping.missingReceipts,
    unknownTaxRows: mapping.unknownTaxRows,
    invoices: mapping.invoices,
    openItems: [],
    openItemCount: 0,
  };
}

/** Der Leser meldet Fehler aus dem Paket; hier wird eine Meldung daraus. */
function readExport(bytes: Uint8Array): AccountableExport {
  try {
    return readAccountableExport(bytes);
  } catch (error) {
    throw new AccountableError(`Der Export lässt sich nicht lesen: ${progressMessage(error)}`);
  }
}

/** Sieht der Export aus wie der aus Accountable? Sonst ist die falsche Datei hochgeladen. */
function looksAccountable(exp: AccountableExport): boolean {
  return exp.receipts.length > 0 || /accountable/i.test(`${exp.stack.header.description} ${[...exp.files.keys()].join(" ")}`);
}

/**
 * Prüft den Upload und legt ihn zum Starten in den Speicher. Liest nur (entpackt im RAM); die Datenbank rührt erst der
 * Lauf an. Wirft AccountableError mit der Ursache.
 */
export function analyseAccountableUpload(bytes: Uint8Array, filename: string): AccountableAnalysis {
  if (bytes.byteLength === 0) throw new AccountableError("Die Datei ist leer.");
  if (bytes.byteLength > MAX_ACCOUNTABLE_SIZE) throw new AccountableError("Die Datei ist größer als 100 MB.");
  const exp = readExport(bytes);
  if (exp.stack.bookings.length === 0) throw new AccountableError("Der Buchungsstapel im Export enthält keine Buchungen.");
  if (!looksAccountable(exp)) {
    throw new AccountableError(
      "Das ist kein Accountable-Export: Es fehlen Belege und die PDF-Ordner. Bitte den DATEV-Export aus Accountable hochladen, mit beigefügten Originaldokumenten.",
    );
  }
  const mapping = mapAccountableExport(exp);
  const analysis = analysisOf(bytes, filename, exp, mapping);
  stageExport({ filename, bytes, export: exp, mapping, analysis });
  return analysis;
}

/** Was bereitliegt, ohne erneuten Upload; für die Oberfläche nach einem Neuladen. */
export function stagedAccountableAnalysis(): AccountableAnalysis | null {
  return stagedExport()?.analysis ?? null;
}

export function discardAccountableUpload() {
  stageExport(null);
}

export type AccountableImportRun = typeof schema.lexofficeImports.$inferSelect & { accountable: AccountableAnalysis | null };

function runOf(row: typeof schema.lexofficeImports.$inferSelect): AccountableImportRun {
  return { ...row, accountable: row.progress.accountable ?? null };
}

/** Letzter Accountable-Lauf; ein hängengebliebener Lauf (Server neu gestartet) gilt als abgebrochen. */
export async function latestAccountableImport(): Promise<AccountableImportRun | null> {
  const [row] = await db
    .select()
    .from(schema.lexofficeImports)
    .where(eq(schema.lexofficeImports.source, "accountable"))
    .orderBy(desc(schema.lexofficeImports.startedAt))
    .limit(1);
  if (!row) return null;
  if (row.status === "laeuft" && !running.has(row.id) && Date.now() - row.updatedAt.getTime() > STALE_MS) {
    const [updated] = await db
      .update(schema.lexofficeImports)
      .set({ status: "abgebrochen", error: "Der Abruf wurde unterbrochen. Ein neuer Abruf setzt dort fort.", finishedAt: new Date() })
      .where(and(eq(schema.lexofficeImports.id, row.id), eq(schema.lexofficeImports.status, "laeuft")))
      .returning();
    return runOf(updated ?? row);
  }
  return runOf(row);
}

/** Fortschritt eines Laufs; null, wenn die ID zu keinem Accountable-Lauf gehört. */
export async function accountableImportStatus(id: string): Promise<AccountableImportRun | null> {
  const [row] = await db
    .select()
    .from(schema.lexofficeImports)
    .where(and(eq(schema.lexofficeImports.id, id), eq(schema.lexofficeImports.source, "accountable")));
  return row ? runOf(row) : null;
}

/**
 * Startet den Lauf für den hochgeladenen Export im Hintergrund. Ein neuer Lauf überspringt, was schon liegt (je GUID), und
 * setzt nach einem Abbruch fort. Gibt die ID des Laufs zurück; den Fortschritt liefert accountableImportStatus.
 */
export async function startAccountableImport(actor: string, options: { wait?: boolean } = {}): Promise<string> {
  const upload = stagedExport();
  if (!upload) throw new AccountableError("Zuerst den Export hochladen.");
  // Der eindeutige Index gilt über alle Quellen: verwaiste Läufe anderer Quellen als abgebrochen markieren
  await latestImport();
  await latestSevdeskImport();
  await latestAccountableImport();
  const progress: LexofficeImportProgress = {
    phase: "belege",
    contacts: 0,
    contactsLinked: 0,
    listed: upload.mapping.vouchers.length,
    imported: 0,
    skipped: 0,
    files: 0,
    failed: [],
    accountable: { ...upload.analysis },
  };
  const [row] = await withActor(actor, (tx) =>
    tx.insert(schema.lexofficeImports).values({ source: "accountable", progress }).returning({ id: schema.lexofficeImports.id }),
  ).catch((error: unknown) => {
    // Der eindeutige Index lässt nur einen laufenden Abruf zu, auch über alle Quellen
    if (isUniqueViolation(error, "lexoffice_imports_one_running")) throw new AccountableError("Ein Abruf läuft bereits.");
    throw error;
  });
  const id = row!.id;
  running.add(id);
  cancelled.delete(id);
  // Ein Lauf ist eine Transaktion: Der Fortschritt wird über `db` geschrieben, das außerhalb der Transaktion nichts sieht.
  // Scheitert der Lauf, sind auch die Belege des Laufs zurückgerollt, und ein zweiter Lauf nimmt alles vollständig mit
  // (der Export liegt dann schon im Archiv).
  const job = withActor(actor, (tx) => runAccountableImport(tx, id, upload, progress))
    .then(() => finish(id, progress, "fertig", null))
    .catch((error: unknown) => finish(id, progress, cancelled.has(id) ? "abgebrochen" : "fehler", cancelled.has(id) ? "Abgebrochen." : progressMessage(error)))
    // Scheitert auch das Speichern des Abschlusses, darf das keine unbehandelte Ablehnung werden
    .catch((error: unknown) => console.error("Accountable-Abruf: Abschluss nicht gespeichert", error))
    .finally(() => {
      running.delete(id);
      cancelled.delete(id);
    });
  if (options.wait) await job;
  return id;
}

export function cancelAccountableImport(id: string): boolean {
  if (!running.has(id)) return false;
  cancelled.add(id);
  return true;
}

/** Offene Posten eines Laufs: Buchungen ohne Belegdatei, nachvollziehbar aus dem Archiv. */
export async function accountableOpenItems(importId: string) {
  return db
    .select({
      id: schema.lexofficeVouchers.id,
      number: schema.lexofficeVouchers.number,
      date: schema.lexofficeVouchers.date,
      gross: schema.lexofficeVouchers.gross,
      contactName: schema.lexofficeVouchers.contactName,
      sameReceiptAs: sql<string | null>`${schema.lexofficeVouchers.raw}->>'sameReceiptAs'`,
    })
    .from(schema.lexofficeVouchers)
    .where(
      and(
        eq(schema.lexofficeVouchers.importId, importId),
        eq(schema.lexofficeVouchers.source, "accountable"),
        sql`coalesce((${schema.lexofficeVouchers.raw}->>'ohneBeleg')::boolean, false)`,
      ),
    )
    .orderBy(schema.lexofficeVouchers.date, schema.lexofficeVouchers.number);
}
