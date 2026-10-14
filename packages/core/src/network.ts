const REASONS: Record<string, string> = {
  EAI_AGAIN: "Name nicht auflösbar, DNS antwortet nicht",
  ENOTFOUND: "Name nicht auflösbar",
  ECONNREFUSED: "Verbindung abgelehnt, Firewall oder Proxy prüfen",
  ETIMEDOUT: "Zeitüberschreitung, Firewall oder Proxy prüfen",
  UND_ERR_CONNECT_TIMEOUT: "Zeitüberschreitung, Firewall oder Proxy prüfen",
  ECONNRESET: "Verbindung abgebrochen, Firewall oder Proxy prüfen",
  ENETUNREACH: "Netz nicht erreichbar",
  EHOSTUNREACH: "Host nicht erreichbar",
};

const CERTIFICATE = /CERT|SIGNATURE|SELF_SIGNED|ALTNAME/;

/** Fehlercode aus der Ursachenkette; Node legt ihn bei fetch eine Ebene unter „fetch failed“ ab */
function errorCode(error: unknown, depth = 0): string | null {
  if (!error || typeof error !== "object" || depth > 4) return null;
  const { code, cause, errors } = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof code === "string") return code;
  // Bei IPv4 und IPv6 parallel kommt ein AggregateError
  if (Array.isArray(errors)) {
    for (const inner of errors) {
      const found = errorCode(inner, depth + 1);
      if (found) return found;
    }
  }
  return errorCode(cause, depth + 1);
}

/** Lesbarer Grund für einen gescheiterten fetch-Aufruf, z. B. „Name nicht auflösbar, DNS antwortet nicht (EAI_AGAIN)“ */
export function networkErrorText(error: unknown): string {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  if (!code) return message;
  const reason = REASONS[code] ?? (CERTIFICATE.test(code) ? "Zertifikat nicht vertrauenswürdig, TLS-Proxy oder CA prüfen" : message);
  return `${reason} (${code})`;
}
