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
