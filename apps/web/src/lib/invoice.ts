import type { DraftInput } from "../server/modules/rechnungen/index.ts";

export type InvoiceFormat = DraftInput["format"];

export const FORMAT_LABEL: Record<InvoiceFormat, string> = {
  zugferd: "ZUGFeRD · EN 16931 (PDF mit XML)",
  "xrechnung-cii": "XRechnung 3.0 (CII)",
  "xrechnung-ubl": "XRechnung 3.0 (UBL)",
};
export const FORMATS = Object.keys(FORMAT_LABEL) as InvoiceFormat[];

export const KIND_TITLE = { rechnung: "Rechnung", storno: "Stornorechnung", korrektur: "Rechnungskorrektur", angebot: "Angebot" } as const;
export const VARIANT_TITLE = { abschlag: "Abschlagsrechnung", schluss: "Schlussrechnung" } as const;

/** Überschrift einer Rechnung: Abschlags- und Schlussrechnung heißen so, sonst nach Art */
export function invoiceTitle(kind: keyof typeof KIND_TITLE, variant?: keyof typeof VARIANT_TITLE | null): string {
  return kind === "rechnung" && variant ? VARIANT_TITLE[variant] : KIND_TITLE[kind];
}

/** Ansprechpartner eines Kunden, wie der Entwurf sie zur Auswahl hat (ContactPersonOption) */
interface DraftPerson {
  id: string;
  contactId: string;
  deactivated: boolean;
}

/**
 * Der einzige aktive Ansprechpartner des Kunden, sonst leer (#1335): Hat der Kunde genau einen, ist er im Entwurf von
 * Rechnung und Angebot gleich ausgewählt und lässt sich mit „Keiner“ abwählen.
 */
export function einzigerAnsprechpartner(persons: readonly DraftPerson[], contactId: string): string {
  const aktive = persons.filter((p) => p.contactId === contactId && !p.deactivated);
  return aktive.length === 1 ? aktive[0]!.id : "";
}

interface DraftContact<S, L> {
  id: string;
  isCustomer: boolean;
  defaultFormat: InvoiceFormat | null;
  leitwegId: string | null;
  language: L;
  skonto: S[] | null;
}

/**
 * Neuer Entwurf für einen Kunden (Kontaktseite, #1557; Schlussrechnung) mit seinen Vorgaben wie beim Wählen im Editor
 * (chooseContact in use-invoice-editor-figures.ts): Format (mit Leitweg-ID XRechnung), Sprache, Skonto ohne Fristen über das
 * Zahlungsziel hinaus, der einzige aktive Ansprechpartner (einzigerAnsprechpartner). null, wenn der Kontakt fehlt (archiviert, unbekannt) oder kein Kunde ist.
 */
export function customerDraft<S extends { days: number }, L, D extends { format: InvoiceFormat; paymentTermDays: number }>(
  draft: D,
  contacts: readonly DraftContact<S, L>[],
  contactId: string | null | undefined,
  companySkonto: readonly S[],
  persons: readonly DraftPerson[] = [],
):
  | (Omit<D, "contactId" | "language" | "format" | "skonto"> & {
      contactId: string;
      language: L;
      format: InvoiceFormat;
      skonto: S[];
      contactPersonId: string;
    })
  | null {
  const contact = contacts.find((c) => c.id === contactId && c.isCustomer);
  if (!contact) return null;
  return {
    ...draft,
    contactId: contact.id,
    language: contact.language,
    format: contact.defaultFormat ?? (contact.leitwegId ? ("xrechnung-cii" as const) : draft.format),
    skonto: (contact.skonto ?? companySkonto).filter((s) => s.days <= draft.paymentTermDays),
    contactPersonId: einzigerAnsprechpartner(persons, contact.id),
  };
}
