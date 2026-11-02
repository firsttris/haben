import type { LexofficeClient } from "./client.ts";

/**
 * Woher der Umzug liest: die Public API (LexofficeClient) oder eine Sicherung aus der Web-Oberfläche
 * (webExportSource). Beide liefern die Antworten in der Form der Public API.
 */
export type LexofficeSource = Pick<
  LexofficeClient,
  "contacts" | "postingCategories" | "voucherList" | "salesDocument" | "salesDocumentPdf" | "salesDocumentXml" | "voucher" | "file" | "payments"
>;
