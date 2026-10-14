import type { ReactNode } from "react";

/** Grobe Einordnung technischer Fehlertexte (Mail-Server, Netz) für die Überschrift des Hinweises */
export function errorKind(detail: string): string {
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|ENETUNREACH|timed? ?out/i.test(detail)) return "Server nicht erreichbar";
  if (/auth|login|credential|password|passwort|535|534/i.test(detail)) return "Anmeldung abgelehnt";
  if (/cert|tls|ssl|self.signed/i.test(detail)) return "Verschlüsselte Verbindung fehlgeschlagen";
  return "Fehler";
}

/** Gespeicherter Fehler als roter Hinweis: verständliche Überschrift, technischer Text aufklappbar. Kein role="alert", er ist beim Laden schon da. */
export function ErrorBanner({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <div className="banner banner-danger error-banner">
      <div style={{ minWidth: 0 }}>
        <strong>
          {title}: {errorKind(detail)}.
        </strong>
        {children && <> {children}</>}
        <details>
          <summary>Technische Details</summary>
          <code>{detail}</code>
        </details>
      </div>
    </div>
  );
}
