import { periodKey } from "@haben/core";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { loadFile } from "../../storage.ts";
import { csv, type CsvValue, money } from "./csv.ts";
import { safeName } from "./export-paths.ts";
import type { ArchiveFile } from "./export-zip.ts";
import { kennzahlenOf } from "./voranmeldungen-archiv.ts";

/*
 * Übermittelte Voranmeldungen aus der bisherigen Buchhaltung (legacy_vat_reports) im Jahresexport, im Jahr ihres
 * Zeitraums: je Anmeldung die unveränderte Antwort und das Übermittlungsprotokoll, dazu eine Übersicht. Getrennt von
 * umsatzsteuer/, das nur die Voranmeldungen aus Haben enthält.
 */

const encoder = new TextEncoder();

export async function vatReportFiles(year: number, problems: string[]): Promise<ArchiveFile[]> {
  const reports = await db
    .select()
    .from(schema.legacyVatReports)
    .where(eq(schema.legacyVatReports.year, year))
    .orderBy(asc(schema.legacyVatReports.month), asc(schema.legacyVatReports.submittedAt), asc(schema.legacyVatReports.externalId));
  if (!reports.length) return [];
  const files = await db
    .select()
    .from(schema.legacyVatReportFiles)
    .where(
      inArray(
        schema.legacyVatReportFiles.vatReportId,
        reports.map((r) => r.id),
      ),
    )
    .orderBy(asc(schema.legacyVatReportFiles.createdAt), asc(schema.legacyVatReportFiles.id));
  const out: ArchiveFile[] = [];
  const rows: CsvValue[][] = [];
  for (const report of reports) {
    const period = report.month == null ? `${report.year}_${safeName(report.periodText)}` : periodKey({ year: report.year, month: report.month });
    const label = `${report.source}-Voranmeldung ${period}`;
    const base = `${report.source}/voranmeldungen/${period}_${report.id.slice(0, 8)}`;
    out.push({ path: `${base}/quelle.json`, content: encoder.encode(JSON.stringify(report.raw, null, 2)), compress: true });
    const attached = files.filter((f) => f.vatReportId === report.id);
    if (!attached.length) problems.push(`${label}: Übermittlungsprotokoll fehlt.`);
    for (const file of attached) {
      try {
        out.push({
          path: `${base}/${file.id.slice(0, 8)}_${safeName(file.filename, 100, "protokoll.pdf")}`,
          content: new Uint8Array(await loadFile(file.sha256)),
          compress: false,
        });
      } catch {
        problems.push(`${label}: Protokoll ${file.filename} nicht lesbar.`);
      }
    }
    rows.push([
      period,
      report.periodText,
      report.submittedAt?.toISOString() ?? null,
      report.actualTaxation == null ? null : report.actualTaxation ? "Ist" : "Soll",
      report.corrected ? "ja" : "nein",
      report.transferTicket,
      money(report.kz83),
      kennzahlenOf(report.raw)
        .map((k) => `${k.kz}=${money(k.cents)}`)
        .join(" | "),
      report.externalId,
      attached.map((f) => f.sha256).join(" | "),
    ]);
  }
  for (const source of [...new Set(reports.map((r) => r.source))]) {
    out.push({
      path: `${source}/voranmeldungen.csv`,
      content: csv(
        ["Zeitraum", "Zeitraum laut Quelle", "Übermittelt", "Versteuerung", "Berichtigt", "Transferticket", "Kz 83", "Kennzahlen", "Quell-ID", "SHA-256"],
        rows.filter((_, i) => reports[i]!.source === source),
      ),
      compress: true,
    });
  }
  return out;
}
