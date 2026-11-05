/**
 * Höchstzahl zusätzlicher Anhänge je Rechnung (#272). Eigene Datei ohne Importe: Das Schema des Mail-Versands braucht
 * die Zahl schon beim Laden, und attachments.ts hängt über die Belege in einem Kreis von Modulen.
 */
export const MAX_INVOICE_ATTACHMENTS = 10;
