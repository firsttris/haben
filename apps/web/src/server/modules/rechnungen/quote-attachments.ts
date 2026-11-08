import { schema } from "../../db/index.ts";
import { attachmentStore, type Attachment } from "./attachment-store.ts";
import { lockDraft, QuoteError } from "./quotes.ts";

/**
 * Zusätzliche Anhänge an Angeboten (#415): PDF-Dateien wie AGB, Widerrufsbelehrung oder auftragsspezifische
 * Vereinbarungen, die mit dem Angebot verschickt werden. Dieselbe Logik wie bei Rechnungen (attachment-store.ts);
 * Hinzufügen und Entfernen nur im Entwurf, mit dem Festschreiben sperrt die Datenbank sie (quote_attachments_locked,
 * 0164). Das PDF des Angebots bleibt unverändert.
 */

export type QuoteAttachment = Attachment;

const store = attachmentStore({
  table: schema.quoteAttachments,
  owner: schema.quoteAttachments.quoteId,
  ownerValues: (quoteId) => ({ quoteId }),
  lockDraft: (tx, quoteId) => lockDraft(tx, quoteId),
  fail: (message) => new QuoteError(message),
  perOwner: "je Angebot",
  ofOwner: "zu diesem Angebot",
});

export const listQuoteAttachments = store.list;
export const addQuoteAttachment = store.add;
export const removeQuoteAttachment = store.remove;
export const loadQuoteAttachment = store.load;
/** Dateien der Anhänge eines Angebots, bevor es gelöscht wird (Entwurf löschen) */
export const quoteAttachmentFiles = store.files;
/** Anhänge in den kopierten Entwurf übernehmen */
export const copyQuoteAttachments = store.copy;
/** Dateien aus dem Speicher an einen neuen Entwurf hängen (Standardanhänge) */
export const attachStoredToQuote = store.attachStored;
export const quoteAttachmentsForMail = store.forMail;
