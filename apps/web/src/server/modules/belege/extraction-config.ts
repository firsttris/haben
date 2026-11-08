import type { Env } from "../../env.ts";

/** Modell für Anthropic; unverändert gegenüber der Auslesung vor den Anbietern */
export const ANTHROPIC_MODEL = "claude-opus-5-5";

export type ExtractionConfig =
  | { provider: "anthropic"; model: string; apiKey: string }
  | {
      provider: "openai-compatible";
      model: string;
      /** Vollständige Adresse von /chat/completions */
      endpoint: string;
      apiKey: string | null;
      timeoutMs: number;
      maxPages: number;
      /** Bei PDFs: Text der Seiten und Bilder, nur Text (reines Textmodell) oder nur Bilder (#329) */
      input: ExtractionInput;
    };

export type ExtractionInput = "text-und-bild" | "text" | "bild";

type ExtractionEnv = Pick<
  Env,
  | "ANTHROPIC_API_KEY"
  | "EXTRACTION_PROVIDER"
  | "EXTRACTION_BASE_URL"
  | "EXTRACTION_MODEL"
  | "EXTRACTION_API_KEY"
  | "EXTRACTION_TIMEOUT_SECONDS"
  | "EXTRACTION_MAX_PAGES"
  | "EXTRACTION_INPUT"
>;

/**
 * Genau ein Anbieter oder keiner. Ist ein selbst betriebener Dienst eingerichtet, gilt nur er, auch wenn zusätzlich
 * ANTHROPIC_API_KEY gesetzt ist: Belege sollen dann den eigenen Server nie Richtung Cloud verlassen.
 */
export function extractionConfig(env: ExtractionEnv): ExtractionConfig | null {
  const provider = env.EXTRACTION_PROVIDER ?? (env.EXTRACTION_BASE_URL ? "openai-compatible" : "anthropic");
  if (provider === "anthropic") {
    return env.ANTHROPIC_API_KEY ? { provider, model: ANTHROPIC_MODEL, apiKey: env.ANTHROPIC_API_KEY } : null;
  }
  // env.ts lässt den Start ohne Basis-URL und Modell nicht zu; hier nur zur Sicherheit
  if (!env.EXTRACTION_BASE_URL || !env.EXTRACTION_MODEL) return null;
  return {
    provider,
    model: env.EXTRACTION_MODEL,
    endpoint: chatCompletionsUrl(env.EXTRACTION_BASE_URL),
    apiKey: env.EXTRACTION_API_KEY || null,
    timeoutMs: env.EXTRACTION_TIMEOUT_SECONDS * 1000,
    maxPages: env.EXTRACTION_MAX_PAGES,
    input: env.EXTRACTION_INPUT,
  };
}

/** „http://ollama:11434/v1“ → „http://ollama:11434/v1/chat/completions“; eine vollständige Adresse bleibt, wie sie ist */
export function chatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/chat/completions") ? path : `${path}/chat/completions`;
  return url.toString();
}

/** Adresse für Anzeige und Meldungen: ohne Zugangsdaten und Query, die Schlüssel enthalten könnten */
export function publicEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.origin}${url.pathname}`;
}

/** Was Einstellungen › KI-Assistenten und API über die Auslesung zeigt; nie den Schlüssel selbst */
export interface ExtractionSettings {
  provider: ExtractionConfig["provider"] | null;
  model: string | null;
  endpoint: string | null;
  keySet: boolean;
  maxPages: number | null;
  timeoutSeconds: number | null;
  /** Nur beim eigenen Dienst: was bei PDFs an ihn geht */
  input?: ExtractionInput;
}

export function extractionSettings(config: ExtractionConfig | null): ExtractionSettings {
  if (!config) return { provider: null, model: null, endpoint: null, keySet: false, maxPages: null, timeoutSeconds: null };
  if (config.provider === "anthropic") {
    return { provider: config.provider, model: config.model, endpoint: null, keySet: true, maxPages: null, timeoutSeconds: null };
  }
  return {
    provider: config.provider,
    model: config.model,
    endpoint: publicEndpoint(config.endpoint),
    keySet: config.apiKey !== null,
    maxPages: config.maxPages,
    timeoutSeconds: config.timeoutMs / 1000,
    input: config.input,
  };
}
