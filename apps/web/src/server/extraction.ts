import { UserError } from "./errors.ts";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS, type Cents } from "@haben/core";
import { z } from "zod";
import { env } from "./env.ts";
import type { DocumentKind } from "./storage.ts";

/** Festes Schema für die KI-Auslesung; Beträge als Dezimaltext, damit nichts gerundet wird. */
const extractionSchema = z.object({
  lieferant: z.string().nullable().describe("Name des Rechnungsstellers"),
  lieferantUstId: z.string().nullable().describe("USt-IdNr. des Rechnungsstellers, z. B. DE123456789"),
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

export type Extraction = z.infer<typeof extractionSchema>;

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

const MODEL = "claude-opus-5-5";

const CATEGORY_LIST = Object.entries(EXPENSE_CATEGORIES)
  .map(([key, { label }]) => `- ${key}: ${label}`)
  .join("\n");

const SYSTEM = `Du liest Eingangsbelege (Rechnungen, Quittungen) eines deutschen Freiberuflers für die Buchhaltung aus.
Gib nur zurück, was auf dem Beleg steht; rate keine Beträge oder Nummern. Fehlt eine Angabe, setze null.
Weise die Beträge je Umsatzsteuersatz (19, 7 oder 0 %) aus. Wenn der Beleg nur einen Bruttobetrag und den Steuersatz nennt, rechne Netto und Steuer daraus.
Wähle die passende Ausgabenkategorie:
${CATEGORY_LIST}
Beschreibe Unklarheiten kurz im Feld hinweis.`;

export function extractionAvailable(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY);
}

let client: Anthropic | undefined;

function getClient(): Anthropic {
  client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  return client;
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
  if (extraction.waehrung.trim().toUpperCase() !== "EUR") warnings.push(`Währung ${extraction.waehrung.slice(0, 10)}: bitte in Euro umrechnen`);
  if (extraction.hinweis) warnings.push(extraction.hinweis.slice(0, 500));
  // Längen wie im Beleg-Formular (documentInputSchema)
  return {
    supplierName: extraction.lieferant?.trim().slice(0, 200) ?? "",
    supplierUstId: extraction.lieferantUstId?.replace(/\s/g, "").toUpperCase().slice(0, 20) ?? "",
    invoiceNumber: extraction.rechnungsnummer?.trim().slice(0, 100) ?? "",
    documentDate: isoDate(extraction.belegdatum),
    dueDate: isoDate(extraction.faelligAm),
    currency: extraction.waehrung.trim().toUpperCase().slice(0, 10),
    category: extraction.kategorie,
    amounts,
    warnings,
  };
}

class ExtractionError extends UserError {}

/** Liest einen Beleg (PDF oder Bild) mit Claude aus. Das Ergebnis wird immer vom Nutzer bestätigt. */
export async function extractDocument(bytes: Uint8Array, kind: DocumentKind): Promise<{ extraction: Extraction; fields: ExtractedFields }> {
  const data = Buffer.from(bytes).toString("base64");
  let source: Anthropic.Beta.BetaContentBlockParam;
  if (kind === "pdf") {
    source = { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  } else if (kind === "jpeg" || kind === "png" || kind === "webp") {
    source = { type: "image", source: { type: "base64", media_type: `image/${kind}`, data } };
  } else {
    throw new ExtractionError("Dieses Dateiformat kann die KI nicht lesen. Bitte als PDF, JPEG oder PNG hochladen.");
  }

  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    // Bei einer Ablehnung beantwortet ein passendes Ersatzmodell dieselbe Anfrage.
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(extractionSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: [source, { type: "text", text: "Lies diesen Beleg aus." }] }],
  });

  if (response.stop_reason === "refusal") {
    throw new ExtractionError("Die KI hat die Auslesung abgelehnt. Bitte die Felder von Hand ausfüllen.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new ExtractionError("Die KI-Antwort war unvollständig. Bitte erneut versuchen oder von Hand ausfüllen.");
  }
  return { extraction: response.parsed_output, fields: toFields(response.parsed_output) };
}

export function describeExtractionError(error: unknown): string {
  if (error instanceof ExtractionError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) return "Der Anthropic-API-Schlüssel ist ungültig.";
  if (error instanceof Anthropic.RateLimitError) return "Die KI ist gerade ausgelastet. Bitte später erneut auslesen.";
  if (error instanceof Anthropic.BadRequestError) return `Die KI konnte den Beleg nicht verarbeiten: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return "Keine Verbindung zur KI. Bitte später erneut versuchen.";
  if (error instanceof Anthropic.APIError) return `Fehler der KI-Schnittstelle (${error.status ?? "?"}).`;
  if (error instanceof UserError) return error.message;
  // z. B. Datenbankfehler: Interna gehören ins Server-Log, nicht an den Beleg
  console.error("KI-Auslesung", error);
  return "Die Auslesung ist fehlgeschlagen. Bitte erneut auslesen oder von Hand ausfüllen.";
}
