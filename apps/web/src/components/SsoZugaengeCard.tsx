import { formatDateTime } from "../lib/format.ts";
import { ROLLEN_LABEL, type Rolle } from "../lib/rollen.ts";
import { STEUERBERATUNG_DOCS } from "./ZugaengeCard.tsx";

interface SsoAccount {
  id: string;
  name: string;
  email: string;
  role: Rolle | null;
  confirmedAt: Date | string;
  lastLoginAt: Date | string | null;
}

/**
 * Einstellungen → Zugänge im SSO-Modus: nur ansehen. Welche Konten sich schon angemeldet haben, mit der zuletzt
 * bestätigten Rolle; Gruppen und Konten verwaltet der Anmeldedienst. Kein Abbild seines Verzeichnisses.
 */
export function SsoZugaengeCard({ accounts, providerName }: { accounts: SsoAccount[]; providerName: string }) {
  return (
    <section className="card" aria-labelledby="zugaenge-heading">
      <h2 id="zugaenge-heading">Zugänge</h2>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        Wer Haben nutzen darf und mit welcher Rolle, legst du in {providerName} über die Gruppen fest. Hier stehen nur die Konten, die sich schon bei Haben
        angemeldet haben, mit der Rolle aus ihrer letzten Anmeldung. Neue Mitglieder erscheinen nach ihrer ersten Anmeldung; eine Änderung der Gruppen wirkt
        spätestens 15 Minuten später.{" "}
        <a href={STEUERBERATUNG_DOCS} target="_blank" rel="noreferrer">
          Mehr dazu
        </a>
      </p>
      {accounts.length === 0 && <p className="small muted">Noch keine Anmeldung über SSO.</p>}
      {accounts.map((account) => (
        <div key={account.id} className="history-row">
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontWeight: 500, overflowWrap: "anywhere" }}>
              {account.name} {account.role ? <span className="pill">{ROLLEN_LABEL[account.role]}</span> : <span className="pill pill-warn">kein Zugang</span>}
            </span>
            <span className="small muted" style={{ overflowWrap: "anywhere" }}>
              {account.email} · {account.role ? "Rolle bestätigt" : "abgewiesen"} {formatDateTime(account.confirmedAt)}
              {account.lastLoginAt ? ` · zuletzt angemeldet ${formatDateTime(account.lastLoginAt)}` : ""}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}
