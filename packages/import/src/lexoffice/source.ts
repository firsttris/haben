import type { LexofficeClient } from "./client.ts";

/**
 * Woher der Umzug liest: die Public API (LexofficeClient) oder eine Sicherung aus der Web-Oberfläche
 * (webExportSource). Beide liefern die Antworten in der Form der Public API.
 */
export type LexofficeSource = Pick<
  LexofficeClient,
  "contacts" | "postingCategories" | "voucherList" | "salesDocument" | "salesDocumentPdf" | "salesDocumentXml" | "voucher" | "file" | "payments"
> & {
  /**
   * Nur die Sicherung aus der Web-Oberfläche kennt das (#1504): Vorgänge, die ohne bekannte Belegart nicht in der
   * Belegliste auftauchen. Der Lauf übergeht sie wie bisher, zählt sie aber, damit die Lücke sichtbar wird.
   */
  ignoredVouchers?(): { type: string; number: string }[];
};
