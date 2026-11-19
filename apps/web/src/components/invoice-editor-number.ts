import { customerNumberProblem, effectiveCustomerNumber, formatDocumentNumber, usesCustomerNumber } from "@haben/core";
import type { ContactOption } from "./invoice-editor-types.ts";

// Nummer in der Vorschau des Editors (InvoiceEditor.tsx)

export function previewCustomerNumber(
  contact: Pick<ContactOption, "kundennummer"> | null,
  corrects: { buyer?: { kundennummer?: string } | null } | null,
  kundenkreis = false,
): string | undefined {
  // Im Kundenkreis gehört die Nummer zum Kreis und trägt immer die heutige Kundennummer des Kontakts (#1426)
  return corrects && !kundenkreis ? effectiveCustomerNumber(corrects.buyer, contact) : (contact?.kundennummer ?? undefined);
}

// {KUNDENNR} zeigt die Kundennummer des Käufers, beim Storno und der Korrektur im gemeinsamen Kreis die des Originals,
// solange sie taugt, im Kundenkreis die des Kontakts (#1426); ohne verwendbare Nummer bleibt {KUNDENNR} stehen, das
// Problem dazu steht in der Liste über dem Formular
export function previewNumber(
  format: string,
  date: string,
  counter: number,
  contact: Pick<ContactOption, "kundennummer"> | null,
  corrects: { buyer?: { kundennummer?: string } | null } | null,
  kundenkreis = false,
): string {
  const kundennummer = previewCustomerNumber(contact, corrects, kundenkreis);
  return formatDocumentNumber(format, date, counter, usesCustomerNumber(format) && customerNumberProblem(kundennummer) ? undefined : kundennummer);
}
