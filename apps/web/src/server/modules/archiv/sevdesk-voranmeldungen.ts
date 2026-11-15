import { isSevVatReportArchivable, mapSevVatReport, SevdeskApiError, type SevdeskClient, type SevFile, type SevVatReport } from "@haben/import";
import { eq, inArray, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { sha256Of, storeFile } from "../../storage.ts";
import { progressMessage } from "./lexoffice.ts";

/*
 * Übermittelte Umsatzsteuer-Voranmeldungen aus sevDesk ins Archiv (#472), mit dem Übermittlungsprotokoll als PDF. Nur
 * Nachweis: Die Zeilen landen in legacy_vat_reports, nie in vat_returns. Haben rechnet sie nicht neu, sendet sie nicht,
 * und eine eigene Voranmeldung für denselben Zeitraum bleibt davon unberührt. Testübermittlungen bleiben draußen.
 */

function isFatal(error: unknown, signal: AbortSignal): boolean {
  if (error instanceof SevdeskApiError && (error.status === 401 || error.status === 403)) return true;
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

export async function importSevdeskVatReports(
  actor: string,
  importId: string,
  client: SevdeskClient,
  progress: LexofficeImportProgress,
  signal: AbortSignal,
): Promise<void> {
  const listed: SevVatReport[] = [];
  try {
    for await (const raw of client.vatReports()) if (isSevVatReportArchivable(raw)) listed.push(raw);
  } catch (error) {
    if (isFatal(error, signal)) throw error;
    // Nur Archiv: Ein Fehler darf den übrigen Abruf nicht verhindern
    progress.failed.push({ lexofficeId: "vatreport", number: "Voranmeldungen", message: progressMessage(error) });
    return;
  }
  if (listed.length === 0) return;
  // Schon archivierte Voranmeldungen; die ohne Protokoll bekommen es nachgeladen, ihre Zeile bleibt unverändert
  const known = new Map(
    (
      await db
        .select({
          externalId: schema.legacyVatReports.externalId,
          id: schema.legacyVatReports.id,
          hasFile: sql<boolean>`exists (select 1 from legacy_vat_report_files f where f.vat_report_id = legacy_vat_reports.id)`,
        })
        .from(schema.legacyVatReports)
        .where(
          inArray(
            schema.legacyVatReports.externalId,
            listed.map((raw) => `vatreport/${raw.id}`),
          ),
        )
    ).map((r) => [r.externalId, r]),
  );
  for (const raw of listed) {
    const externalId = `vatreport/${raw.id}`;
    const archived = known.get(externalId);
    if (archived?.hasFile) continue;
    try {
      const report = mapSevVatReport(raw);
      if (archived) await addMissingProtocol(actor, client, report, archived.id, progress);
      else if (await importVatReport(actor, importId, client, raw, progress)) progress.vatReports = (progress.vatReports ?? 0) + 1;
    } catch (error) {
      if (isFatal(error, signal)) throw error;
      progress.failed.push({ lexofficeId: externalId, number: `Voranmeldung ${periodOf(raw)}`, message: progressMessage(error) });
    }
  }
}

function periodOf(raw: SevVatReport): string {
  const r = raw as Record<string, unknown>;
  return [r.reportingYear, r.reportingPeriodCode, r.reportingPeriod].filter((v) => typeof v === "string" || typeof v === "number").join(" ");
}

type Mapped = ReturnType<typeof mapSevVatReport>;

async function protocol(client: SevdeskClient, report: Mapped): Promise<SevFile | null> {
  return report.documentId ? client.document(report.documentId) : null;
}

async function importVatReport(actor: string, importId: string, client: SevdeskClient, raw: SevVatReport, progress: LexofficeImportProgress): Promise<boolean> {
  const report = mapSevVatReport(raw);
  const pdf = await protocol(client, report);
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(schema.legacyVatReports)
      .values({
        externalId: report.externalId,
        source: "sevdesk",
        importId,
        year: report.year,
        month: report.month,
        periodText: report.periodText,
        submittedAt: report.submittedAt ? new Date(report.submittedAt) : null,
        actualTaxation: report.actualTaxation,
        corrected: report.corrected,
        transferTicket: report.ticket,
        kz83: report.kz83,
        raw: raw as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: schema.legacyVatReports.externalId })
      .returning({ id: schema.legacyVatReports.id });
    // Ein gleichzeitiger Lauf hat die Voranmeldung schon archiviert
    if (!row) return false;
    if (pdf) await storeProtocol(tx, row.id, report, pdf, progress);
    return true;
  });
}

function fileName(report: Mapped): string {
  const period =
    report.month == null ? report.periodText.replace(/\W+/g, "_") : report.month > 40 ? `Q${report.month - 40}` : String(report.month).padStart(2, "0");
  return `UStVA_${report.year}-${period}${report.corrected ? "_berichtigt" : ""}_Protokoll.pdf`;
}

async function storeProtocol(tx: Tx, vatReportId: string, report: Mapped, pdf: SevFile, progress: LexofficeImportProgress): Promise<void> {
  const sha256 = sha256Of(pdf.bytes);
  await storeFile(pdf.bytes);
  const [file] = await tx
    .insert(schema.legacyVatReportFiles)
    .values({
      vatReportId,
      // sevDesk vergibt zufällige Namen ohne Endung; der Zeitraum sagt mehr
      filename: fileName(report),
      mimeType: pdf.mimeType.split(";")[0]!.trim() || "application/pdf",
      sha256,
      size: pdf.bytes.byteLength,
    })
    .onConflictDoNothing({ target: [schema.legacyVatReportFiles.vatReportId, schema.legacyVatReportFiles.sha256] })
    .returning({ id: schema.legacyVatReportFiles.id });
  if (file) progress.files += 1;
}

/** Protokoll einer schon archivierten Voranmeldung, das beim früheren Abruf fehlte; nur anhängend */
async function addMissingProtocol(actor: string, client: SevdeskClient, report: Mapped, vatReportId: string, progress: LexofficeImportProgress): Promise<void> {
  const pdf = await protocol(client, report);
  if (!pdf) return;
  await withActor(actor, async (tx) => {
    // Ein gleichzeitiger Lauf kann das Protokoll schon angehängt haben
    const [present] = await tx
      .select({ id: schema.legacyVatReportFiles.id })
      .from(schema.legacyVatReportFiles)
      .where(eq(schema.legacyVatReportFiles.vatReportId, vatReportId))
      .limit(1);
    if (!present) await storeProtocol(tx, vatReportId, report, pdf, progress);
  });
}
