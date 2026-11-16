/*
 * Eine Datei per multipart/form-data an eine Adresse schicken, wie es Dokumentenarchive für neue Dokumente erwarten.
 * Haben folgt keiner Weiterleitung: Die Kopfzeile mit dem Token geht nur an die eingestellte Adresse (Fetch Standard,
 * redirect "manual"). Erfolg ist jede Antwort 2xx; nennt sie als JSON eine id, merkt Haben sie sich für den Link.
 */

/** So lange darf das Archiv für eine Datei samt Antwort brauchen */
export const SENDEN_TIMEOUT_MS = 60_000;

/** Von der Antwort liest Haben höchstens so viel; mehr als eine id braucht es nicht */
const MAX_ANTWORT = 1024 * 1024;

/** Platzhalter in Zusatzfeldern, mit Beschreibung für die Oberfläche */
export const PLATZHALTER = {
  nummer: "Rechnungsnummer",
  art: "Rechnung, Stornorechnung, Rechnungskorrektur, Abschlags- oder Schlussrechnung",
  datum: "Rechnungsdatum als JJJJ-MM-TT",
  kunde: "Name des Kunden",
  dateiname: "Name der Datei",
} as const;

export type Platzhalter = Record<keyof typeof PLATZHALTER, string>;

/** Setzt die Platzhalter ein; unbekannte bleiben stehen, damit ein Tippfehler im Archiv auffällt */
export function fillPlaceholders(text: string, values: Platzhalter): string {
  return text.replace(/\{([a-z]+)\}/g, (whole, key: string) => (key in values ? values[key as keyof Platzhalter] : whole));
}

export interface Sendung {
  url: string;
  fileField: string;
  header: { name: string; value: string } | null;
  fields: { name: string; value: string }[];
  file: { bytes: Uint8Array; filename: string; mimeType: string };
}

export type SendeErgebnis = { ok: true; httpStatus: number; archiveId: string | null } | { ok: false; httpStatus: number | null; error: string };

/** Liest höchstens `max` Bytes; was darüber hinausgeht, wird nicht mehr geladen */
async function readAtMost(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/** id aus einer JSON-Antwort `{ "id": … }`; alles andere (eine Task-Kennung als Text, HTML) ergibt keine */
function idAus(bytes: Uint8Array | null): string | null {
  if (!bytes?.byteLength) return null;
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (json && typeof json === "object" && !Array.isArray(json)) {
      const id = (json as { id?: unknown }).id;
      if ((typeof id === "string" && /^[^\s/?#]{1,200}$/.test(id)) || (typeof id === "number" && Number.isSafeInteger(id))) return String(id);
    }
  } catch {
    // keine JSON-Antwort
  }
  return null;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen sind hier gesucht
const STEUERZEICHEN = /[\u0000-\u001f\u007f]+/g;

/**
 * Kurzer Auszug einer Fehlerantwort für die Anzeige, ohne Steuerzeichen und ohne den Wert der Kopfzeile: Manche Archive
 * wiederholen das abgelehnte Token in der Meldung, und der Auszug steht in der Datenbank und an der Rechnung.
 */
function auszug(bytes: Uint8Array | null, header: Sendung["header"]): string {
  if (!bytes?.byteLength) return "";
  // Mehr dekodieren als angezeigt, damit ein Token an der Schnittkante ganz erkannt wird
  let text = new TextDecoder().decode(bytes.subarray(0, 16_384)).replace(STEUERZEICHEN, " ");
  for (const geheim of geheimeTeile(header)) text = text.replaceAll(geheim, "***");
  text = text.trim();
  return text ? `: ${text.slice(0, 200)}` : "";
}

/** Der Wert der Kopfzeile und seine längeren Teile (das Token nach „Bearer“), längste zuerst */
function geheimeTeile(header: Sendung["header"]): string[] {
  if (!header?.value) return [];
  const teile = header.value.split(/\s+/).filter((teil) => teil.length >= 8);
  return [header.value, ...teile].sort((a, b) => b.length - a.length);
}

export async function sendFile(sendung: Sendung, timeoutMs = SENDEN_TIMEOUT_MS): Promise<SendeErgebnis> {
  const body = new FormData();
  for (const field of sendung.fields) body.append(field.name, field.value);
  const { bytes, filename, mimeType } = sendung.file;
  body.append(sendung.fileField, new File([bytes as Uint8Array<ArrayBuffer>], filename, { type: mimeType }));
  let response: Response;
  try {
    response = await fetch(sendung.url, {
      method: "POST",
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json", ...(sendung.header ? { [sendung.header.name]: sendung.header.value } : {}) },
    });
  } catch (error) {
    // Verbindung abgelehnt, Name unbekannt, TLS, Zeitlimit; die Meldung nennt die Adresse, nie die Kopfzeile
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : error instanceof Error ? error.message : String(error);
    const zeit = error instanceof Error && error.name === "TimeoutError";
    return { ok: false, httpStatus: null, error: zeit ? `Keine Antwort nach ${timeoutMs / 1000} Sekunden` : `Nicht erreichbar (${cause.slice(0, 200)})` };
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    return {
      ok: false,
      httpStatus: response.status,
      error: `Weiterleitung (HTTP ${response.status}); Haben folgt ihr nicht, bitte die Zieladresse direkt eintragen`,
    };
  }
  const answer = await readAtMost(response.body, MAX_ANTWORT).catch(() => null);
  if (!response.ok) return { ok: false, httpStatus: response.status, error: `HTTP ${response.status}${auszug(answer, sendung.header)}` };
  return { ok: true, httpStatus: response.status, archiveId: idAus(answer) };
}
