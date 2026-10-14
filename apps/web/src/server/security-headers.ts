/** Clickjacking-Schutz der App selbst, unabhängig vom Proxy: HTML-Seiten nur von derselben Origin einbetten */
export const FRAME_ANCESTORS = "frame-ancestors 'self'";

/**
 * Ergänzt HTML-Antworten um `Content-Security-Policy: frame-ancestors 'self'`. Antworten mit eigener CSP
 * (Dateien aus file-response.ts) und alles außer HTML bleiben unverändert.
 */
export function withFrameAncestors(response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("text/html") || response.headers.has("content-security-policy")) return response;
  // Header einer fremden Response können unveränderlich sein; die Kopie ist es nicht
  const copy = new Response(response.body, response);
  copy.headers.set("Content-Security-Policy", FRAME_ANCESTORS);
  return copy;
}
