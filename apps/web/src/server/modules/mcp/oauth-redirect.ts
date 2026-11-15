/** Hosts, zu denen Haben einen Autorisierungscode schicken darf (https); weitere Anbieter kommen hier dazu */
const REDIRECT_HOSTS = new Set(["claude.ai", "claude.com"]);
/** Lokale Clients (RFC 8252, 7.3) auf beliebigem Port */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

/** Nur https zu den Hosts von Claude oder http auf Loopback, ohne Fragment und ohne Zugangsdaten in der URL */
export function allowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return REDIRECT_HOSTS.has(url.hostname) && url.port === "";
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/** Loopback-IP-Adressen, bei denen der Port beim Autorisieren frei ist (RFC 8252, 7.3); „localhost“ bleibt exakt (8.3) */
const LOOPBACK_IPS = new Set(["127.0.0.1", "[::1]"]);

/**
 * Passt die Redirect-URI der Anfrage zu einer registrierten? Exakter Vergleich, nur bei Loopback-IP-Adressen darf der Port
 * abweichen: Lokale Clients holen sich erst beim Start einen freien Port.
 */
export function redirectUriMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  let a: URL;
  let b: URL;
  try {
    a = new URL(registered);
    b = new URL(requested);
  } catch {
    return false;
  }
  if (a.protocol !== "http:" || !LOOPBACK_IPS.has(a.hostname) || b.username || b.password || b.hash) return false;
  return b.protocol === a.protocol && b.hostname === a.hostname && b.pathname === a.pathname && b.search === a.search;
}
