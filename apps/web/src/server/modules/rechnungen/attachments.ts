import { schema } from "../../db/index.ts";
import { attachmentStore, type Attachment } from "./attachment-store.ts";
import { InvoiceError, lockDraft } from "./invoices.ts";

/**
 * Zusätzliche Anhänge an Ausgangsrechnungen (#272): PDF-Dateien wie Stundenzettel oder Leistungsnachweise, die mit der
 * Rechnung verschickt werden. Hinzufügen und Entfernen nur im Entwurf; beim Festschreiben sperrt die Datenbank sie mit
 * der Rechnung (invoice_attachments_locked, 0125). Die Logik teilen sich Rechnungen und Angebote (attachment-store.ts).
 * PDF und XML der Rechnung bleiben unverändert.
 */

export type InvoiceAttachment = Attachment;
export { attachmentFileProblem, attachmentFilename, removeFiles, unusedFiles } from "./attachment-store.ts";

const store = attachmentStore({
  table: schema.invoiceAttachments,
  owner: schema.invoiceAttachments.invoiceId,
  ownerValues: (invoiceId) => ({ invoiceId }),
  lockDraft: (tx, invoiceId) => lockDraft(tx, invoiceId),
  fail: (message) => new InvoiceError(message),
  perOwner: "je Rechnung",
  ofOwner: "zu dieser Rechnung",
});

export const listInvoiceAttachments = store.list;
export const addInvoiceAttachment = store.add;
export const removeInvoiceAttachment = store.remove;
export const loadInvoiceAttachment = store.load;
/** Dateien der Anhänge einer Rechnung, bevor sie gelöscht wird (Entwurf löschen) */
export const attachmentFiles = store.files;
export const attachmentsForMail = store.forMail;
