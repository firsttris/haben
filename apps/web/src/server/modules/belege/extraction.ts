import { env } from "../../env.ts";
import { UserError } from "../../errors.ts";
import type { DocumentKind } from "../../storage.ts";
import { describeAnthropicError, extractWithAnthropic } from "./extraction-anthropic.ts";
import { extractionConfig, extractionSettings as settingsOf, type ExtractionConfig, type ExtractionSettings } from "./extraction-config.ts";
import { extractWithOpenAiCompatible } from "./extraction-openai.ts";
import { ExtractionError, toFields, type ExtractedFields, type Extraction, type ProviderResult } from "./extraction-schema.ts";

/*
 * KI-Auslesung von Belegen: wählt genau einen Anbieter aus der Umgebung (extraction-config.ts) und wandelt seine
 * Antwort mit denselben Prüfungen in Belegfelder um. Schlägt der Anbieter fehl, bleibt es dabei: kein zweiter Versuch
 * bei einem anderen Anbieter, schon gar nicht in der Cloud.
 */

export { decimalToCents, toFields, type ExtractedFields, type Extraction } from "./extraction-schema.ts";

export type ExtractDeps = {
  [P in ExtractionConfig["provider"]]: (config: Extract<ExtractionConfig, { provider: P }>, bytes: Uint8Array, kind: DocumentKind) => Promise<ProviderResult>;
};

const PROVIDERS: ExtractDeps = { anthropic: extractWithAnthropic, "openai-compatible": extractWithOpenAiCompatible };

function activeConfig(): ExtractionConfig | null {
  return extractionConfig(env());
}

export function extractionAvailable(): boolean {
  return activeConfig() !== null;
}

/** Für Einstellungen › KI-Assistenten und API: Anbieter, Modell und Adresse, nie der Schlüssel */
export function extractionSettings(): ExtractionSettings {
  return settingsOf(activeConfig());
}

/** Liest einen Beleg (PDF oder Bild) aus. Das Ergebnis wird immer vom Nutzer bestätigt. */
export async function extractDocument(
  bytes: Uint8Array,
  kind: DocumentKind,
  config: ExtractionConfig | null = activeConfig(),
  providers: ExtractDeps = PROVIDERS,
): Promise<{ extraction: Extraction; fields: ExtractedFields }> {
  if (!config) throw new ExtractionError("Die KI-Auslesung ist nicht eingerichtet.", "nicht-eingerichtet");
  let result: ProviderResult;
  try {
    result = await callProvider(config, bytes, kind, providers);
  } catch (error) {
    // Nachvollziehbar ohne Beleginhalt, Meldung des Dienstes oder Schlüssel: nur Anbieter, Modell und Fehlerart
    console.warn(`KI-Auslesung fehlgeschlagen (${config.provider}, ${config.model}): ${failureReason(error)}`);
    throw error;
  }
  const fields = toFields(result.extraction);
  return { extraction: result.extraction, fields: { ...fields, warnings: [...result.warnings, ...fields.warnings] } };
}

function callProvider(config: ExtractionConfig, bytes: Uint8Array, kind: DocumentKind, providers: ExtractDeps): Promise<ProviderResult> {
  return config.provider === "anthropic" ? providers.anthropic(config, bytes, kind) : providers["openai-compatible"](config, bytes, kind);
}

function failureReason(error: unknown): string {
  if (error instanceof ExtractionError) return error.reason;
  const status = (error as { status?: unknown } | null)?.status;
  const name = error instanceof Error ? error.constructor.name : typeof error;
  return typeof status === "number" ? `${name} ${status}` : name;
}

export function describeExtractionError(error: unknown): string {
  if (error instanceof ExtractionError) return error.message;
  const anthropic = describeAnthropicError(error);
  if (anthropic) return anthropic;
  if (error instanceof UserError) return error.message;
  // z. B. Datenbankfehler: Interna gehören ins Server-Log, nicht an den Beleg
  console.error("KI-Auslesung", error);
  return "Die Auslesung ist fehlgeschlagen. Bitte erneut auslesen oder von Hand ausfüllen.";
}
