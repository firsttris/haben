import { customerNumberProblem, effectiveCustomerNumber, formatDocumentNumber, usesCustomerNumber } from "@haben/core";
import type { ContactOption } from "./invoice-editor-types.ts";

// Nummer in der Vorschau des Editors (InvoiceEditor.tsx)

export function previewCustomerNumber(
  contact: Pick<ContactOption, "kundennummer"> | null,
  corrects: { buyer?: { kundennummer?: string } | null } | null,
): string | undefined {
  return corrects ? effectiveCustomerNumber(corrects.buyer, contact) : (contact?.kundennummer ?? undefined);
}

// {KUNDENNR} zeigt die Kundennummer des Käufers, beim Storno und der Korrektur die des Originals, solange sie taugt
// (#1426); ohne verwendbare Nummer bleibt {KUNDENNR} stehen, das Problem dazu steht in der Liste über dem Formular
export function previewNumber(
  format: string,
  date: string,
  counter: number,
  contact: Pick<ContactOption, "kundennummer"> | null,
  corrects: { buyer?: { kundennummer?: string } | null } | null,
): string {
  const kundennummer = previewCustomerNumber(contact, corrects);
  return formatDocumentNumber(format, date, counter, usesCustomerNumber(format) && customerNumberProblem(kundennummer) ? undefined : kundennummer);
}
