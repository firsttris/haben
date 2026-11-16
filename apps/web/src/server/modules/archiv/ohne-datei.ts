/**
 * Belege, die sich als „ohne Datei“ bestätigen lassen. Bei sevDesk, weil dort abgerufen wurde und der Abruf das Fehlen
 * festgestellt hat. Beim Accountable-Stapel nur, wenn die Buchung gar keine Beleg-GUID trägt: dort gibt es von
 * vornherein keinen Einzelbeleg. Eine Buchung mit GUID, deren Datei nur im Export fehlt, ist ausdrücklich nicht
 * bestätigbar, und Rechnungen und Gutschriften brauchen ihr Original-PDF.
 */
export function ohneDateiBestaetigbar(v: { source: string; lexofficeId: string; type: string; guid?: string | null }): boolean {
  if (v.source === "sevdesk") return v.lexofficeId.startsWith("voucher/");
  if (v.source === "accountable") return v.lexofficeId.startsWith("accountable/row/") && v.type === "purchaseinvoice" && !v.guid;
  return false;
}

/**
 * Warum zu einer Buchung keine Datei da ist (#1235). Nur der erste Fall lädt zum Bestätigen ein; bei WISO und der
 * Lexoffice-Sicherung setzt der Import das Merkmal ohne Beleg-GUID, über einen Einzelbeleg sagt das nichts.
 */
export type OhneBelegGrund = "kein_beleglink" | "datei_fehlt_im_export" | "quelle_ohne_beleg";

export function ohneBelegGrund(v: { source: string; guid?: string | null }): OhneBelegGrund {
  if (v.source !== "accountable") return "quelle_ohne_beleg";
  return v.guid ? "datei_fehlt_im_export" : "kein_beleglink";
}
