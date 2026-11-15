/** Clickjacking-Schutz der App selbst, unabhängig vom Proxy: HTML-Seiten nur von derselben Origin einbetten */
export const FRAME_ANCESTORS = "frame-ancestors 'self'";

/**
 * Seiten, die nie in einem Rahmen stehen dürfen, auch nicht auf derselben Origin: die Zustimmung zu einer OAuth-Verbindung
 * (RFC 9700, 4.16). X-Frame-Options DENY zusätzlich für Browser ohne CSP; ein Proxy, der SAMEORIGIN setzt, ändert daran
 * nichts, denn frame-ancestors geht vor.
 */
const NEVER_FRAMED = ["/oauth/autorisieren"];

/**
 * Ergänzt HTML-Antworten um `Content-Security-Policy: frame-ancestors 'self'`, auf den Seiten aus NEVER_FRAMED um
 * `frame-ancestors 'none'` und `X-Frame-Options: DENY`. Antworten mit eigener CSP (Dateien aus file-response.ts) und alles
 * außer HTML bleiben unverändert.
 */
export function withFrameAncestors(response: Response, pathname = ""): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("text/html") || response.headers.has("content-security-policy")) return response;
  // Header einer fremden Response können unveränderlich sein; die Kopie ist es nicht
  const copy = new Response(response.body, response);
  if (NEVER_FRAMED.includes(pathname)) {
    copy.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    copy.headers.set("X-Frame-Options", "DENY");
  } else copy.headers.set("Content-Security-Policy", FRAME_ANCESTORS);
  return copy;
}
