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

/** Datei einer API-Route laden und speichern; bei einem Fehler wirft sie dessen Text */
export async function downloadFrom(url: string, fallback: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error((await response.text()) || "Die Datei ließ sich nicht laden.");
  saveBlob(await response.blob(), filenameFrom(response.headers.get("Content-Disposition"), fallback));
}

/** Datei, die eine Server Function Base64-kodiert liefert, speichern */
export function saveBase64File(file: { filename: string; base64: string }, mimeType: string) {
  saveBlob(new Blob([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], { type: mimeType }), file.filename);
}
