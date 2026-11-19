import type {
  LetterheadDesign,
  PaymentPlanRow,
  PlanTemplate,
  FinalizedCircleRef,
  Bundesland,
  PriceMode,
  SkontoStufe,
  TaxTreatment,
  OutgoingTaxDetails,
} from "@haben/core";
import type { ReactNode } from "react";
import type { useAction } from "../lib/use-action.ts";
import type { EditorLine } from "../lib/editor-lines.ts";
import type { KIND_TITLE } from "../lib/invoice.ts";
import type { DraftInput } from "../server/modules/rechnungen/index.ts";
import type { MandateOption } from "../server/modules/stammdaten/index.ts";
import type { ArticleOption } from "./ArticleCombobox.tsx";
import type { ContactPersonOption } from "./ContactPersonField.tsx";
import type { TextBlockOption } from "./TextBlockField.tsx";

// Typen des Editors für Rechnung und Angebot (InvoiceEditor.tsx)

export interface ContactOption {
  id: string;
  name: string;
  ort: string;
  strasse: string;
  plz: string;
  kundennummer: string | null;
  defaultFormat: DraftInput["format"] | null;
  leitwegId: string;
  language: "de" | "en";
  /** Eigenes Skonto des Kunden; null = Vorgabe aus den Firmendaten */
  skonto: SkontoStufe[] | null;
  /** Nur Kunden stehen zur Auswahl; ein schon gewählter Kontakt bleibt sichtbar */
  isCustomer: boolean;
  /** Für den Hinweis auf eine Dublette beim Anlegen im Dialog */
  ustId: string;
}

/** Abschlagsrechnung, die eine Schlussrechnung abziehen kann */
export interface AbschlagOption {
  id: string;
  contactId: string | null;
  /** Angebot, zu dem der Abschlag gehört */
  quoteId: string | null;
  number: string;
  issueDate: string;
  gross: number;
  rates: { rate: number; base: number; tax: number }[];
  taxTreatment: TaxTreatment;
  taxDetails: OutgoingTaxDetails | null;
  exemptionReason: string;
  priceMode: PriceMode;
  propertyRetention: boolean;
}

/** Festgeschriebenes Angebot, zu dem eine Abschlags- oder Schlussrechnung gehören kann */
export interface QuoteOption {
  id: string;
  contactId: string | null;
  number: string;
  issueDate: string;
}

/** Werte beim Öffnen; beim Angebot zusätzlich Gültigkeit und Zahlungsplan */
export type EditorInitial = Omit<DraftInput, "lines"> & {
  lines: EditorLine[];
  validUntil?: string;
  paymentPlan?: PaymentPlanRow[];
  paymentPlanInConfirmation?: boolean;
};

/** Props von InvoiceEditor */
export type InvoiceEditorProps = {
  /** Vom Aufrufer, wenn er den Editor nach dem Speichern per `key` neu aufsetzt: sonst ginge die Meldung dabei verloren */
  action?: ReturnType<typeof useAction>;
  id: string | null;
  kind: keyof typeof KIND_TITLE;
  /** Beim Angebot zusätzlich Gültigkeit und Zahlungsplan; Zahlungsziel und Format spielen dort keine Rolle */
  initial: EditorInitial;
  contacts: ContactOption[];
  /** Gestaltung aus dem Profil und das Logo; die Firmendaten fürs Blatt liest der Server */
  seller: { logo?: string | null; design?: LetterheadDesign };
  sellerIssues: string[];
  /** GmbH und UG: fehlende Pflichtangaben für Geschäftsbriefe (§ 35a GmbHG); nur ein Hinweis, keine Sperre */
  letterIssues?: string[];
  issues: string[];
  /** Letzte vergebene Nummer je Kreis: Jahr, 0 = durchlaufender Zähler */
  numberCounters: Record<number, number>;
  /** Nummernformat aus den Einstellungen, z. B. "RE-{JJJJ}-{MM}-{NNN}" */
  numberFormat: string;
  /** Zähler läuft über den Jahreswechsel weiter (#328) */
  numberRunning?: boolean;
  /** Zuletzt festgeschriebene Rechnung je Kreis (#713) */
  lastFinalized?: Record<number, FinalizedCircleRef>;
  corrects: { number: string | null; issueDate: string; buyer?: { kundennummer?: string } | null } | null;
  /** Für die Fälligkeit: Feiertage im Bundesland */
  bundesland: Bundesland | null;
  kleinunternehmer: boolean;
  /** Artikelkatalog zum Einfügen von Positionen */
  articles?: ArticleOption[];
  /** Kopf- und Fußtexte zum Einfügen */
  textBlocks?: TextBlockOption[];
  /** Eigene Einheiten (#748) neben den festen */
  units?: readonly string[];
  /** Offene Abschlagsrechnungen für die Schlussrechnung */
  abschlaege?: AbschlagOption[];
  /** Festgeschriebene Angebote, für den Bezug von Abschlags- und Schlussrechnungen */
  quotes?: QuoteOption[];
  /** Tageskurs vom Finanzamt gestattet: dann mit Kursdatum */
  tageskurs?: boolean;
  /** Gespeicherter Kurs mit Herkunft, z. B. „1 EUR = 1,0812 USD (USt-Umrechnungskurs 09/2026)“ */
  rateInfo?: string | null;
  /** Skonto aus den Firmendaten, wenn der gewählte Kunde kein eigenes hat */
  companySkonto?: SkontoStufe[];
  /** Abschnitt für zusätzliche Anhänge (#272); nur bei einem gespeicherten Rechnungsentwurf */
  attachments?: ReactNode;
  /** Vorlagen für den Zahlungsplan im Angebot, aus den Einstellungen */
  planTemplates?: PlanTemplate[];
  /** Gültige Lastschriftmandate aller Kunden (#445), für die Zahlungsart der Rechnung */
  mandates?: MandateOption[];
  /** Ansprechpartner aller Kunden (#424), für die Auswahl unter „Kunde“ */
  contactPersons?: ContactPersonOption[];
  /** Korrektur einer Schlussrechnung: die übernommenen Abzüge, fest; Haben behält sie beim Speichern */
  keptDeductions?: { description: string; quantity: number; unit: string; unitPrice: number; taxRate: 1900 | 700 | 0; deductionOf: string }[];
};
