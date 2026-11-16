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
