import { z } from "zod";
import type { DocumentKind } from "../../storage.ts";
import { publicEndpoint, type ExtractionConfig } from "./extraction-config.ts";
import { EXTRACTION_INSTRUCTIONS, EXTRACTION_REQUEST, ExtractionError, extractionSchema, readableKind, type ProviderResult } from "./extraction-schema.ts";
import { pdfToPageImages, type PdfToImages } from "./pdf-pages.ts";

/*
 * Selbst betriebener Dienst mit OpenAI-kompatibler Schnittstelle (POST /v1/chat/completions), z. B. Ollama, LM Studio,
 * vLLM oder Docker Model Runner. Referenz: https://platform.openai.com/docs/api-reference/chat/create und
 * https://docs.ollama.com/api/openai-compatibility. Bilder gehen als data:-URL im Teil „image_url“, PDFs vorher als
 * Seitenbilder. Strukturierte Ausgabe über response_format „json_schema“; lehnt der Dienst das ab, fragt Haben denselben
 * Dienst ohne und prüft die Antwort selbst gegen das Schema. Einen Ausweg zu einem anderen Anbieter gibt es nicht.
 */

type OpenAiConfig = Extract<ExtractionConfig, { provider: "openai-compatible" }>;

export interface OpenAiDeps {
  fetch: typeof fetch;
  pdfToImages: PdfToImages;
}

const defaultDeps: OpenAiDeps = { fetch: (...args) => fetch(...args), pdfToImages: pdfToPageImages };

/** Größere Antworten sind keine Belegfelder mehr */
const MAX_RESPONSE_CHARS = 1_000_000;

const JSON_SCHEMA = z.toJSONSchema(extractionSchema);

/** Ohne strukturierte Ausgabe muss das Modell das Format aus der Anweisung kennen */
const INSTRUCTIONS = `${EXTRACTION_INSTRUCTIONS}
Antworte ausschließlich mit einem JSON-Objekt nach diesem JSON-Schema, ohne weiteren Text:
${JSON.stringify(JSON_SCHEMA)}`;

export async function extractWithOpenAiCompatible(
  config: OpenAiConfig,
  bytes: Uint8Array,
  kind: DocumentKind,
  deps: OpenAiDeps = defaultDeps,
): Promise<ProviderResult> {
  const readable = readableKind(kind);
  const warnings: string[] = [];
  let images: string[];
  if (readable === "pdf") {
    const { pages, truncated } = await deps.pdfToImages(bytes, config.maxPages);
    if (truncated) warnings.push(`Das PDF hat mehr als ${config.maxPages} Seiten; ausgelesen wurden nur die ersten ${config.maxPages}.`);
    images = pages.map((page) => dataUrl("image/png", page));
  } else {
    images = [dataUrl(`image/${readable}`, bytes)];
  }

  const signal = AbortSignal.timeout(config.timeoutMs);
  let response = await post(config, deps, requestBody(config.model, images, true), signal);
  if (!response.ok && (await rejectsStructuredOutput(response))) {
    response = await post(config, deps, requestBody(config.model, images, false), signal);
  }
  if (!response.ok) throw await httpError(config, response);
  const content = await answerText(response, signal, config);
  return { extraction: parseExtraction(content), warnings };
}

function dataUrl(mediaType: string, bytes: Uint8Array): string {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function requestBody(model: string, images: string[], structured: boolean) {
  return {
    model,
    stream: false,
    temperature: 0,
    messages: [
      { role: "system", content: INSTRUCTIONS },
      {
        role: "user",
        content: [{ type: "text", text: EXTRACTION_REQUEST }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))],
      },
    ],
    ...(structured ? { response_format: { type: "json_schema", json_schema: { name: "beleg", strict: true, schema: JSON_SCHEMA } } } : {}),
  };
}

async function post(config: OpenAiConfig, deps: OpenAiDeps, body: unknown, signal: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  try {
    // Keiner Umleitung folgen: Ein 307/308 schickte den Beleg sonst an einen anderen Host als den eingerichteten
    return await deps.fetch(config.endpoint, { method: "POST", headers, body: JSON.stringify(body), signal, redirect: "manual" });
  } catch (error) {
    throw networkError(config, error);
  }
}

function networkError(config: OpenAiConfig, error: unknown): ExtractionError {
  if (isTimeout(error)) {
    return new ExtractionError(
      `Der KI-Dienst hat nicht innerhalb von ${config.timeoutMs / 1000} Sekunden geantwortet. Bitte erneut auslesen oder EXTRACTION_TIMEOUT_SECONDS erhöhen.`,
      "zeitueberschreitung",
    );
  }
  return new ExtractionError(
    `Der KI-Dienst unter ${publicEndpoint(config.endpoint)} ist nicht erreichbar. Läuft er, und erreicht Haben die Adresse (im Container z. B. host.docker.internal statt localhost)?`,
    "nicht-erreichbar",
  );
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** 400 oder 422 mit Hinweis auf response_format/json_schema: der Dienst kann keine strukturierte Ausgabe */
async function rejectsStructuredOutput(response: Response): Promise<boolean> {
  if (response.status !== 400 && response.status !== 422) return false;
  const text = await response
    .clone()
    .text()
    .catch(() => "");
  return /response_format|json_schema|structured|grammar/i.test(text);
}

/** Meldung des Dienstes kurz an den Beleg; sie steht nicht im Server-Log */
async function serverMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    const message = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? parsed.message);
    if (typeof message === "string") return message.slice(0, 300);
  } catch {
    // keine JSON-Antwort
  }
  return text.slice(0, 300);
}

async function httpError(config: OpenAiConfig, response: Response): Promise<ExtractionError> {
  const status = response.status;
  const reason = `http-${status}`;
  if (status >= 300 && status < 400) {
    return new ExtractionError(
      `Der KI-Dienst unter ${publicEndpoint(config.endpoint)} leitet auf eine andere Adresse um. Haben folgt keinen Umleitungen, damit Belege nur an die eingerichtete Adresse gehen. Bitte EXTRACTION_BASE_URL auf die richtige Adresse setzen.`,
      "umleitung",
    );
  }
  if (status === 401 || status === 403) {
    return new ExtractionError(
      config.apiKey
        ? "Der KI-Dienst hat den Schlüssel abgelehnt. Bitte EXTRACTION_API_KEY prüfen."
        : "Der KI-Dienst verlangt einen Schlüssel. Bitte EXTRACTION_API_KEY setzen.",
      reason,
    );
  }
  if (status === 404) {
    return new ExtractionError(
      `Der KI-Dienst kennt das Modell „${config.model}“ oder den Pfad ${publicEndpoint(config.endpoint)} nicht. Bitte EXTRACTION_MODEL und EXTRACTION_BASE_URL (meist mit /v1 am Ende) prüfen.`,
      reason,
    );
  }
  const detail = await serverMessage(response);
  if (status === 400 || status === 413 || status === 422) {
    return new ExtractionError(
      `Der KI-Dienst konnte den Beleg nicht verarbeiten (HTTP ${status}). Kann das Modell „${config.model}“ Bilder lesen (Vision-Modell)?${detail ? ` Meldung: ${detail}` : ""}`,
      reason,
    );
  }
  if (status === 429) return new ExtractionError("Der KI-Dienst ist gerade ausgelastet. Bitte später erneut auslesen.", reason);
  return new ExtractionError(`Fehler des KI-Dienstes (HTTP ${status}).${detail ? ` Meldung: ${detail}` : ""}`, reason);
}

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({
          content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }))]).nullish(),
          refusal: z.string().nullish(),
        }),
      }),
    )
    .min(1),
});

/** Text der ersten Antwort; Fehler, wenn sie fehlt, abgelehnt oder abgeschnitten ist */
async function answerText(response: Response, signal: AbortSignal, config: OpenAiConfig): Promise<string> {
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    throw signal.aborted ? networkError(config, error) : invalidAnswer();
  }
  if (raw.length > MAX_RESPONSE_CHARS) throw invalidAnswer();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw invalidAnswer();
  }
  const parsed = completionSchema.safeParse(json);
  if (!parsed.success) throw invalidAnswer();
  const [choice] = parsed.data.choices;
  if (choice!.message.refusal) {
    throw new ExtractionError("Die KI hat die Auslesung abgelehnt. Bitte die Felder von Hand ausfüllen.", "abgelehnt");
  }
  if (choice!.finish_reason === "length") {
    throw new ExtractionError("Die KI-Antwort war unvollständig. Bitte erneut versuchen oder von Hand ausfüllen.", "unvollstaendig");
  }
  const content = choice!.message.content;
  const text = typeof content === "string" ? content : (content ?? []).map((part) => part.text ?? "").join("");
  if (!text.trim()) throw invalidAnswer();
  return text;
}

function invalidAnswer(): ExtractionError {
  return new ExtractionError(
    "Die Antwort des KI-Dienstes passt nicht zum Belegschema. Bitte erneut auslesen, ein anderes Modell wählen oder die Felder von Hand ausfüllen.",
    "schema",
  );
}

/**
 * JSON aus der Antwort, auch wenn das Modell ohne strukturierte Ausgabe Text drumherum schreibt (Denkblock, ```json).
 * Geprüft wird gegen dasselbe Schema wie bei Anthropic; nur Zahlen statt Dezimaltext werden angenommen.
 */
export function parseExtraction(text: string) {
  const withoutThinking = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = withoutThinking.indexOf("{");
  const end = withoutThinking.lastIndexOf("}");
  if (start < 0 || end < start) throw invalidAnswer();
  let json: unknown;
  try {
    json = JSON.parse(withoutThinking.slice(start, end + 1));
  } catch {
    throw invalidAnswer();
  }
  const parsed = extractionSchema.safeParse(numbersAsText(json));
  if (!parsed.success) throw invalidAnswer();
  return parsed.data;
}

/** 19 statt "19", 32.4 statt "32.40": JSON-Zahlen mit höchstens zwei Nachkommastellen bleiben als Text exakt */
function numbersAsText(json: unknown): unknown {
  if (!json || typeof json !== "object" || Array.isArray(json)) return json;
  const record = json as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "number" ? String(value) : value);
  const rows = Array.isArray(record.betraege)
    ? record.betraege.map((row) =>
        row && typeof row === "object" ? { ...row, steuersatz: text(row.steuersatz), netto: text(row.netto), steuer: text(row.steuer) } : row,
      )
    : record.betraege;
  return { ...record, betraege: rows, brutto: text(record.brutto) };
}
