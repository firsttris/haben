import { authClient } from "../lib/auth-client.ts";
import { formatDate } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";

/** Passkeys des angemeldeten Kontos (Einstellungen des Inhabers, Startseite der Steuerberatung) */
export function PasskeysCard() {
  // aktualisiert sich nach Hinzufügen und Entfernen selbst
  const passkeys = authClient.useListPasskeys().data ?? [];
  const action = useAction();
  const { busy, notice } = action;

  // better-auth meldet Fehler im Ergebnis statt per Exception
  const run = (work: () => Promise<{ error?: { message?: string } | null } | undefined>, success: string) =>
    action.run(async () => {
      const result = await work();
      if (result?.error) throw new Error(result.error.message ?? "Fehlgeschlagen");
    }, success);

  return (
    <section className="card" aria-labelledby="passkey-heading">
      <h2 id="passkey-heading">Passkeys</h2>
      {passkeys.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          Noch kein Passkey. Mit einem Passkey meldest du dich ohne Passwort an.
        </p>
      ) : (
        passkeys.map((passkey) => (
          <div key={passkey.id} className="history-row">
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 500 }}>{passkey.name || "Passkey"}</span>
              {passkey.createdAt && <span className="small muted">angelegt {formatDate(passkey.createdAt)}</span>}
            </div>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => run(() => authClient.passkey.deletePasskey({ id: passkey.id }), "Passkey entfernt.")}
            >
              Entfernen
            </button>
          </div>
        ))
      )}
      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => run(() => authClient.passkey.addPasskey({ name: "Haben" }), "Passkey hinzugefügt.")}
        >
          Passkey hinzufügen
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </section>
  );
}
