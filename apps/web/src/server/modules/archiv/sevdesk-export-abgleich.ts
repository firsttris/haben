import type { LegacySource } from "../../db/schema.ts";
import type { ReconciliationCheck } from "./lexoffice.ts";

/*
 * Abgleich je Jahr für Belege aus der Export-ZIP von sevDesk (#1106). Ein Exportbeleg steht in einem von drei Zuständen:
 *
 * - mit Datei: Beleglink und Belegbild im Export (oder aus einem späteren Upload nachgetragen);
 * - Datei fehlt: Beleglink da, die Datei fehlt im Export. Ein Fehler, wie ein Beleg aus der API ohne Datei;
 * - ohne Belegbild im Export: Belegdaten ohne Beleglink. Eigene Zahl, kein Fehler: Ein Bild gibt es in sevDesk nicht.
 *
 * Der vierte Zustand, Buchungen ohne Beleg (Zahlung, Privat, Umbuchung), steht wie bei den anderen Quellen bei den
 * Buchungen des Stapels („ohne Belegnummer“, datevWithoutReceipt).
 *
 * Bei Ist-Versteuerung wird ein Exportjahr nicht vollständig: Der Export ordnet Zahlungen keinem Beleg zu, die
 * Umsatzsteuer je Monat lässt sich daraus nicht ableiten. Bei Soll zählt das Belegdatum.
 */

export interface ExportVoucherRow {
  source: LegacySource;
  files: number;
  ohneBelegbild: boolean;
}

export interface SevdeskExportYear {
  withFile: number;
  missingFile: number;
  withoutImage: number;
}

export const SEVDESK_EXPORT_IST_ISSUE =
  "Ist-Versteuerung: Der sevDesk-Export ordnet Zahlungen keinem Beleg zu, die Umsatzsteuer je Monat lässt sich daraus nicht ableiten. Das Jahr bleibt unvollständig; vergleiche die Voranmeldungen in sevDesk.";

/** Belege mit Belegdaten, aber ohne Belegbild im Export: brauchen keine Datei */
export const withoutExportImage = (v: ExportVoucherRow) => v.source === "sevdesk-export" && v.ohneBelegbild && Number(v.files) === 0;

/** Zahlen der Exportbelege eines Jahres; null, wenn das Jahr keine hat */
export function sevdeskExportYear(yearRows: ExportVoucherRow[]): SevdeskExportYear | null {
  const rows = yearRows.filter((v) => v.source === "sevdesk-export");
  if (rows.length === 0) return null;
  const withFile = rows.filter((v) => Number(v.files) > 0).length;
  const withoutImage = rows.filter(withoutExportImage).length;
  return { withFile, withoutImage, missingFile: rows.length - withFile - withoutImage };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Ersetzt „Belege und Rechnungen per API abgerufen“ in einem Jahr nur aus dem Export */
export function sevdeskExportChecks(year: SevdeskExportYear, versteuerung: "ist" | "soll"): ReconciliationCheck[] {
  const total = year.withFile + year.missingFile + year.withoutImage;
  return [
    ...(versteuerung === "ist" ? [{ ok: false, label: "Zahlungshistorie vollständig", detail: "Der sevDesk-Export ordnet Zahlungen keinem Beleg zu" }] : []),
    {
      ok: true,
      label: "Belege aus dem sevDesk-Export übernommen",
      detail: [
        plural(total, "Beleg", "Belege"),
        `${year.withFile} mit Datei`,
        year.withoutImage > 0 ? `${year.withoutImage} ohne Belegbild im Export` : "",
        year.missingFile > 0 ? `${plural(year.missingFile, "Datei fehlt", "Dateien fehlen")} im Export` : "",
      ]
        .filter(Boolean)
        .join(", "),
    },
  ];
}
