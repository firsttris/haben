import { mapSevVatReport } from "@haben/import";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";

/*
 * Lesen der archivierten Voranmeldungen aus der bisherigen Buchhaltung (legacy_vat_reports). Die Kennzahlen kommen bei
 * jedem Lesen aus der gespeicherten Antwort, nicht aus einer eigenen Spalte: angezeigt wird, was sevDesk geliefert hat.
 */

export type LegacyVatReportRow = Awaited<ReturnType<typeof legacyVatReports>>[number];

/** Voranmeldungen eines Steuerjahres, nach Zeitraum und Übermittlung; mit Kennzahlen in Cent und Protokollen */
export async function legacyVatReports(year: number) {
  const rows = await db
    .select()
    .from(schema.legacyVatReports)
    .where(eq(schema.legacyVatReports.year, year))
    .orderBy(asc(schema.legacyVatReports.month), asc(schema.legacyVatReports.submittedAt), asc(schema.legacyVatReports.externalId));
  if (rows.length === 0) return [];
  const files = await db
    .select({
      id: schema.legacyVatReportFiles.id,
      vatReportId: schema.legacyVatReportFiles.vatReportId,
      filename: schema.legacyVatReportFiles.filename,
      size: schema.legacyVatReportFiles.size,
    })
    .from(schema.legacyVatReportFiles)
    .where(
      inArray(
        schema.legacyVatReportFiles.vatReportId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(schema.legacyVatReportFiles.createdAt));
  return rows.map(({ raw, importId: _, createdAt: __, ...r }) => ({
    ...r,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    kennzahlen: kennzahlenOf(raw),
    files: files.filter((f) => f.vatReportId === r.id).map(({ vatReportId: _, ...f }) => f),
  }));
}

/** Jahre mit archivierten Voranmeldungen, neueste zuerst */
export async function legacyVatReportYears(): Promise<number[]> {
  const rows = await db.selectDistinct({ year: schema.legacyVatReports.year }).from(schema.legacyVatReports);
  return rows.map((r) => r.year).sort((a, b) => b - a);
}

export function kennzahlenOf(raw: Record<string, unknown>): { kz: string; cents: number }[] {
  try {
    return mapSevVatReport({ ...raw, id: String(raw.id ?? "") }).kennzahlen;
  } catch {
    // Ein unlesbares Jahr verhindert schon die Übernahme; hier nur zur Sicherheit
    return [];
  }
}

export async function legacyVatReportFile(fileId: string) {
  const [file] = await db.select().from(schema.legacyVatReportFiles).where(eq(schema.legacyVatReportFiles.id, fileId));
  return file ?? null;
}
