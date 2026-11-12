/*
 * Dateien aus Haben im Browser speichern, ohne die Seite zu verlassen: Ein Fehler des Servers landet so als Meldung in
 * der Seite statt als leere Textseite.
 */

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Erst nach dem Klick freigeben; der Browser hat die Datei dann übernommen
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Dateiname aus `Content-Disposition` (filename* nach RFC 8187, wie fileResponse ihn setzt) */
export function filenameFrom(disposition: string | null, fallback: string): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
  return encoded ? decodeURIComponent(encoded) : fallback;
}

/** Hinweis einer API-Route zur gelieferten Datei, URI-kodiert, weil ein Header nur ASCII trägt */
export const HINWEIS_HEADER = "X-Haben-Hinweis";

/**
 * Obergrenze für den kodierten Hinweis: nginx legt alle Antwort-Header in einen Puffer von einer Speicherseite
 * (`proxy_buffer_size`, 4 oder 8 KiB); passen sie nicht hinein, bekommt der Browser statt der Datei einen 502.
 */
export const HINWEIS_HEADER_MAX_BYTES = 2000;

const kodiert = (zeilen: string[]) => encodeURIComponent(zeilen.join("\n"));

/** Zeilen des Hinweises als Wert für HINWEIS_HEADER, höchstens HINWEIS_HEADER_MAX_BYTES; was nicht passt, wird gezählt */
export function hinweisHeader(zeilen: string[]): string {
  if (kodiert(zeilen).length <= HINWEIS_HEADER_MAX_BYTES) return kodiert(zeilen);
  const rest = (n: number) => [`Und ${n} weitere.`];
  const shown: string[] = [];
  for (const zeile of zeilen) {
    if (kodiert([...shown, zeile, ...rest(zeilen.length - shown.length - 1)]).length > HINWEIS_HEADER_MAX_BYTES) break;
    shown.push(zeile);
  }
  if (shown.length === 0) {
    // Schon die erste Zeile ist zu lang: gekürzt zeigen statt gar nicht. Nach Codepoints, sonst teilt der Schnitt ein
    // Surrogatpaar und encodeURIComponent wirft
    const zeichen = Array.from(zeilen[0]!);
    while (zeichen.length > 0 && kodiert([`${zeichen.join("")}…`, ...rest(zeilen.length - 1)]).length > HINWEIS_HEADER_MAX_BYTES) zeichen.splice(-10);
    shown.push(`${zeichen.join("")}…`);
  }
  const weitere = zeilen.length - shown.length;
  return kodiert(weitere > 0 ? [...shown, ...rest(weitere)] : shown);
}

/** Datei einer API-Route laden und speichern; bei einem Fehler wirft sie dessen Text. Liefert den Hinweis zur Datei oder "" */
export async function downloadFrom(url: string, fallback: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error((await response.text()) || "Die Datei ließ sich nicht laden.");
  saveBlob(await response.blob(), filenameFrom(response.headers.get("Content-Disposition"), fallback));
  const hinweis = response.headers.get(HINWEIS_HEADER);
  return hinweis ? decodeURIComponent(hinweis) : "";
}

/** Datei, die eine Server Function Base64-kodiert liefert, speichern */
export function saveBase64File(file: { filename: string; base64: string }, mimeType: string) {
  saveBlob(new Blob([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], { type: mimeType }), file.filename);
}
