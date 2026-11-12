/**
 * Lässt sich eine eigene Seite im Rahmen von Haben zeigen (#636)? Viele Seiten verbieten das Einbetten, etwa
 * Paperless-ngx; der Rahmen bleibt dann leer oder der Browser meldet „Verbindung abgelehnt“. Haben ruft die Adresse
 * einmal auf und liest die beiden Header, nach denen der Browser entscheidet:
 *
 * - `Content-Security-Policy: frame-ancestors …` (CSP Level 3, Abschnitt 6.4.2): Steht die Direktive in einer
 *   Richtlinie, gilt sie, und `X-Frame-Options` zählt nicht mehr.
 * - `X-Frame-Options` (RFC 7034, HTML Living Standard 7.1.1.4): `DENY` und `SAMEORIGIN` verbieten es, denn die
 *   Seite läuft nie unter der Herkunft von Haben (checkPageUrl). `ALLOW-FROM` kennt kein heutiger Browser mehr, er
 *   behandelt den Header dann wie nicht gesetzt.
 *
 * Das Ergebnis ist ein Hinweis, keine Sperre: Der Server von Haben sieht die Seite unter Umständen anders als der
 * Browser (anderes Netz, Anmeldeseite eines Proxys davor).
 */

export type EmbeddingResult = { status: "allowed" } | { status: "blocked"; header: string } | { status: "unknown"; reason: "unreachable" };

/** Wie lange Haben auf die Seite wartet; der Hinweis soll erscheinen, während man noch im Formular ist */
const TIMEOUT_MS = 5000;

export async function checkEmbedding(url: string, habenUrl: string, fetchFn: typeof fetch = fetch): Promise<EmbeddingResult> {
  try {
    const response = await fetchFn(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "text/html" } });
    // Der Inhalt interessiert nicht, nur die Header
    await response.body?.cancel();
    // Nach Weiterleitungen gilt die Richtlinie der letzten Adresse; ihr Schema zählt für Quellen ohne Schema
    return frameVerdict(response.headers, habenUrl, response.url || url);
  } catch {
    return { status: "unknown", reason: "unreachable" };
  }
}

/**
 * Entscheidet wie der Browser, ob eine Seite unter `pageUrl` mit diesen Headern unter `habenUrl` im Rahmen stehen
 * darf. Ohne `pageUrl` gilt für Quellen ohne Schema http oder https als Schema der Seite.
 */
export function frameVerdict(headers: Headers, habenUrl: string, pageUrl?: string): EmbeddingResult {
  const haben = new URL(habenUrl);
  const pageScheme = pageUrl ? new URL(pageUrl).protocol : null;
  // Headers.get fügt mehrere Header gleichen Namens mit ", " zusammen; jede Richtlinie gilt für sich
  const policies = (headers.get("content-security-policy") ?? "").split(",");
  const ancestors = policies.map(frameAncestors).filter((list): list is string[] => list !== null);
  if (ancestors.length > 0) {
    return ancestors.every((sources) => sources.some((source) => matchesSource(source, haben, pageScheme)))
      ? { status: "allowed" }
      : { status: "blocked", header: "Content-Security-Policy: frame-ancestors" };
  }
  const xfo = (headers.get("x-frame-options") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .find((value) => value === "deny" || value === "sameorigin");
  return xfo ? { status: "blocked", header: `X-Frame-Options: ${xfo.toUpperCase()}` } : { status: "allowed" };
}

/** Quellen der Direktive frame-ancestors einer Richtlinie; null, wenn sie fehlt */
function frameAncestors(policy: string): string[] | null {
  for (const directive of policy.split(";")) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (name?.toLowerCase() === "frame-ancestors") return sources.map((source) => source.toLowerCase());
  }
  return null;
}

const DEFAULT_PORT: Record<string, string> = { "http:": "80", "https:": "443" };

/** scheme-part matching (CSP Level 3, 6.7.2.9): gleich, oder `http:` passt auch auf `https:` */
function schemeMatches(expression: string, url: string): boolean {
  return expression === url || (expression === "http:" && url === "https:");
}

/**
 * Passt eine Quelle auf die Herkunft von Haben (CSP Level 3, 6.7.2.8 „Does url match expression“)? `'none'` und
 * `'self'` passen nie, denn die Seite läuft nie unter der Herkunft von Haben. Pfade zählen bei frame-ancestors nicht.
 * Eine Quelle ohne Schema passt nur, wenn das Schema der Seite auf das von Haben passt (Schritt 4.2): Eine https-Seite
 * mit `frame-ancestors haben.local` lässt sich nicht in Haben unter http einbetten.
 */
function matchesSource(source: string, haben: URL, pageScheme: string | null): boolean {
  if (source === "*") return true;
  // Schema-Quelle wie `https:`; `http:` erlaubt auch https
  if (/^[a-z][a-z0-9+.-]*:$/.test(source)) return schemeMatches(source, haben.protocol);
  const match = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9.-]+)(?::(\d+|\*))?(?:\/.*)?$/.exec(source);
  if (!match) return false;
  const [, scheme, host, port] = match;
  const schemeOk = scheme
    ? schemeMatches(`${scheme}:`, haben.protocol)
    : pageScheme
      ? schemeMatches(pageScheme, haben.protocol)
      : haben.protocol === "http:" || haben.protocol === "https:";
  if (!schemeOk || !host) return false;
  const hostname = haben.hostname.toLowerCase();
  const hostOk = host === "*" || (host.startsWith("*.") ? hostname.endsWith(host.slice(1)) : hostname === host);
  if (!hostOk) return false;
  if (port === "*") return true;
  // Ohne Port passt nur der Standardport des Schemas von Haben (URL.port ist dann leer)
  if (!port) return haben.port === "";
  return port === (haben.port || DEFAULT_PORT[haben.protocol]);
}
