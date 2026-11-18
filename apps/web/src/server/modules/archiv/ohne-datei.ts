/**
 * Belege, die sich als „ohne Datei“ bestätigen lassen. Bei sevDesk, weil dort abgerufen wurde und der Abruf das Fehlen
 * festgestellt hat. Beim Accountable-Stapel nur, wenn die Buchung gar keine Beleg-GUID trägt: dort gibt es von
 * vornherein keinen Einzelbeleg. Eine Buchung mit GUID, deren Datei nur im Export fehlt, ist ausdrücklich nicht
 * bestätigbar, ebenso eine, zu der Daten.xlsx „Dokument Vorhanden“ meldet (Spalte Y gilt für die ganze Rechnung, auch
 * für Zeilen ohne eigene Datei, siehe packages/import/src/accountable/sammelrechnung.ts). Rechnungen und Gutschriften
 * brauchen ihr Original-PDF.
 */
export function ohneDateiBestaetigbar(v: {
  source: string;
  lexofficeId: string;
  type: string;
  guid?: string | null;
  documentPresent?: boolean | null;
}): boolean {
  if (v.source === "sevdesk") return v.lexofficeId.startsWith("voucher/");
  if (v.source === "accountable") return v.lexofficeId.startsWith("accountable/row/") && v.type === "purchaseinvoice" && !v.guid && v.documentPresent !== true;
  return false;
}

/**
 * Warum zu einer Buchung keine Datei da ist (#1235, #1322). Nur der erste Fall lädt zum Bestätigen ein; bei WISO und der
 * Lexoffice-Sicherung setzt der Import das Merkmal ohne Beleg-GUID, über einen Einzelbeleg sagt das nichts.
 *
 * Die Beleg-GUID steht vor „Dokument vorhanden“: sie gilt genau für diese Zeile, dort gibt es einen eigenen Beleg, dessen
 * Datei nur im Export fehlt. Spalte Y aus Daten.xlsx gilt dagegen für die ganze Sammelrechnung und greift deshalb nur
 * bei Zeilen ohne eigene GUID.
 */
export type OhneBelegGrund = "kein_beleglink" | "datei_fehlt_im_export" | "dokument_vorhanden" | "quelle_ohne_beleg";

export function ohneBelegGrund(v: { source: string; guid?: string | null; documentPresent?: boolean | null }): OhneBelegGrund {
  if (v.source !== "accountable") return "quelle_ohne_beleg";
  if (v.guid) return "datei_fehlt_im_export";
  return v.documentPresent === true ? "dokument_vorhanden" : "kein_beleglink";
}
