import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS, type Cents } from "@haben/core";
import { z } from "zod";
import { UserError } from "../../errors.ts";
import type { DocumentKind } from "../../storage.ts";

/*
 * Gemeinsamer Teil der KI-Auslesung für alle Anbieter: Schema der Antwort, Anweisung und die Umwandlung in Belegfelder
 * mit den Prüfungen von Beträgen, Daten und Summen. Die Anbieter (Anthropic, OpenAI-kompatibler Dienst) liefern nur
 * eine nach diesem Schema geprüfte Antwort.
 */

/** Festes Schema für die KI-Auslesung; Beträge als Dezimaltext, damit nichts gerundet wird. */
export const extractionSchema = z.object({
  lieferant: z.string().nullable().describe("Name des Rechnungsstellers"),
  lieferantUstId: z.string().nullable().describe("USt-IdNr. des Rechnungsstellers, z. B. DE123456789"),
  // Nur als Vorschlag für den Kontakt (#329), nie am Beleg oder in einer Überweisung; ältere Antworten ohne die Felder gelten
  lieferantIban: z.string().nullable().default(null).describe("IBAN des Rechnungsstellers für die Zahlung, genau wie auf dem Beleg, sonst null"),
  lieferantIbanFundstelle: z
    .string()
    .nullable()
    .default(null)
    .describe("Wörtlicher kurzer Textausschnitt des Belegs, in dem diese IBAN steht, z. B. die Zeile mit der Bankverbindung"),
  // Für die Erkennung eigener Ausgangsrechnungen (own-invoice.ts): Wer die Rechnung bekommt
  empfaenger: z.string().nullable().describe("Name des Rechnungsempfängers (Anschriftfeld)"),
  empfaengerUstId: z.string().nullable().describe("USt-IdNr. des Rechnungsempfängers, falls angegeben"),
  rechnungsnummer: z.string().nullable(),
  belegdatum: z.string().nullable().describe("Rechnungs- bzw. Belegdatum als YYYY-MM-DD"),
  faelligAm: z.string().nullable().describe("Fälligkeitsdatum als YYYY-MM-DD, falls angegeben"),
  waehrung: z.string().describe("ISO-Währungscode, z. B. EUR"),
  istGutschrift: z.boolean().describe("true bei Gutschrift oder Rechnungskorrektur zu unseren Gunsten"),
  betraege: z
    .array(
      z.object({
        steuersatz: z.enum(["19", "7", "0"]),
        netto: z.string().describe("Nettobetrag zu diesem Steuersatz, Dezimalpunkt, z. B. 1234.50"),
        steuer: z.string().describe("Steuerbetrag zu diesem Steuersatz, Dezimalpunkt"),
      }),
    )
    .describe("Je Steuersatz eine Zeile, positive Beträge"),
  brutto: z.string().nullable().describe("Gesamtbetrag, Dezimalpunkt"),
  kategorie: z.enum(EXPENSE_CATEGORY_KEYS),
  hinweis: z.string().nullable().describe("Kurzer Hinweis, wenn etwas unklar oder unleserlich ist"),
});

/** Antwort nach dem Schema; die Felder mit Vorgabe (IBAN-Vorschlag) dürfen fehlen */
export type Extraction = z.input<typeof extractionSchema>;

export interface ExtractedFields {
  supplierName: string;
  supplierUstId: string;
  invoiceNumber: string;
  documentDate: string | null;
  dueDate: string | null;
  currency: string;
  category: (typeof EXPENSE_CATEGORY_KEYS)[number];
  amounts: { taxRate: 1900 | 700 | 0; net: Cents; tax: Cents }[];
  warnings: string[];
}

/** Antwort eines Anbieters: geprüft nach dem Schema, dazu Hinweise aus der Vorbereitung (z. B. gekürzte Seiten) */
export interface ProviderResult {
  extraction: Extraction;
  warnings: string[];
}

/**
 * Meldung für den Beleg. `reason` ist ein kurzer Code für das Server-Log: Er enthält nie Beleginhalte oder Schlüssel,
 * die Meldung selbst geht nur an den Beleg.
 */
export class ExtractionError extends UserError {
  readonly reason: string;

  constructor(message: string, reason = "auslesung") {
    super(message);
    this.reason = reason;
  }
}

const CATEGORY_LIST = Object.entries(EXPENSE_CATEGORIES)
  .map(([key, { label }]) => `- ${key}: ${label}`)
  .join("\n");

export const EXTRACTION_INSTRUCTIONS = `Du liest Eingangsbelege (Rechnungen, Quittungen) eines deutschen Freiberuflers für die Buchhaltung aus.
Gib nur zurück, was auf dem Beleg steht; rate keine Beträge oder Nummern. Fehlt eine Angabe, setze null.
Die IBAN des Rechnungsstellers nur, wenn sie als dessen Bankverbindung auf dem Beleg steht, nicht die des Empfängers oder aus einem Lastschrifttext; dazu den Textausschnitt, in dem sie steht.
Weise die Beträge je Umsatzsteuersatz (19, 7 oder 0 %) aus. Wenn der Beleg nur einen Bruttobetrag und den Steuersatz nennt, rechne Netto und Steuer daraus.
Wähle die passende Ausgabenkategorie:
${CATEGORY_LIST}
Beschreibe Unklarheiten kurz im Feld hinweis.`;

export const EXTRACTION_REQUEST = "Lies diesen Beleg aus.";

/** Was die KI lesen kann: PDF oder ein Bild; HEIC und XML nicht */
export type ReadableKind = "pdf" | "jpeg" | "png" | "webp";

export function readableKind(kind: DocumentKind): ReadableKind {
  if (kind === "pdf" || kind === "jpeg" || kind === "png" || kind === "webp") return kind;
  throw new ExtractionError("Dieses Dateiformat kann die KI nicht lesen. Bitte als PDF, JPEG oder PNG hochladen.", "format");
}

/** Nur echte Kalenderdaten, 2025-13-45 fällt weg */
const isoDate = (value: string | null) => (value && z.iso.date().safeParse(value).success ? value : null);

/** Höchstens 3 Mio. € je Betrag: auch drei Steuersätze mit Netto und Steuer passen in die int4-Spalten */
const MAX_CENTS = 300_000_000;

/** "1234.5" → 123450; null, wenn kein (plausibler) Betrag */
export function decimalToCents(value: string): Cents | null {
  const match = /^(-)?(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim().replace(/\s/g, ""));
  if (!match) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  if (cents > MAX_CENTS) return null;
  return match[1] ? -cents : cents;
}

/** Wandelt die Modellantwort in Belegfelder um und prüft die Summen. */
export function toFields(extraction: Extraction): ExtractedFields {
  const warnings: string[] = [];
  const sign = extraction.istGutschrift ? -1 : 1;
  const amounts = extraction.betraege.flatMap((row) => {
    const net = decimalToCents(row.netto);
    const tax = decimalToCents(row.steuer);
    if (net === null || tax === null) {
      warnings.push(`Betrag zu ${row.steuersatz} % nicht lesbar`);
      return [];
    }
    return [{ taxRate: (Number(row.steuersatz) * 100) as 1900 | 700 | 0, net: sign * Math.abs(net), tax: sign * Math.abs(tax) }];
  });
  const gross = extraction.brutto ? decimalToCents(extraction.brutto) : null;
  const sum = amounts.reduce((total, a) => total + a.net + a.tax, 0);
  if (gross !== null && Math.abs(sum) !== Math.abs(gross)) {
    warnings.push("Summe aus Netto und Steuer weicht vom Gesamtbetrag ab");
  }
  // „€“ oder „Euro“ statt des Codes ist trotzdem Euro
  const code = extraction.waehrung.trim().toUpperCase();
  const currency = code === "€" || code === "EURO" ? "EUR" : code.slice(0, 10);
  if (currency !== "EUR") warnings.push(`Währung ${currency}: bitte den Umrechnungskurs eintragen`);
  if (extraction.hinweis) warnings.push(extraction.hinweis.slice(0, 500));
  // Längen wie im Beleg-Formular (documentInputSchema)
  return {
    supplierName: extraction.lieferant?.trim().slice(0, 200) ?? "",
    supplierUstId: extraction.lieferantUstId?.replace(/\s/g, "").toUpperCase().slice(0, 20) ?? "",
    invoiceNumber: extraction.rechnungsnummer?.trim().slice(0, 100) ?? "",
    documentDate: isoDate(extraction.belegdatum),
    dueDate: isoDate(extraction.faelligAm),
    currency,
    category: extraction.kategorie,
    amounts,
    warnings,
  };
}
