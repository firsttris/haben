import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { errorMessage } from "../../lib/format.ts";
import { decideOAuthConsent, getOAuthAvailable, getOAuthConsent } from "../../server/functions/oauth.ts";
import { getAuthState } from "../../server/functions/setup.ts";

type Anfrage = Record<string, string>;
type Ansicht = { clientName: string; redirectHost: string; fresh: boolean };

const PARAMETER = ["response_type", "client_id", "redirect_uri", "state", "scope", "code_challenge", "code_challenge_method", "resource"];

/**
 * Zustimmung zu einer OAuth-Verbindung (#96), etwa einem Connector in claude.ai. Die Parameter kommen roh aus der Adresse
 * des Browsers: Der Router würde Werte, die wie JSON aussehen, umwandeln, und state muss unverändert zurück.
 */
export const Route = createFileRoute("/oauth/autorisieren")({
  beforeLoad: async () => {
    const state = await getAuthState();
    if (!state.initialized) throw redirect({ to: "/setup" });
    // Ausgeschaltet gibt es den OAuth-Weg nicht, auch nicht diese Seite
    if (!(await getOAuthAvailable())) throw notFound();
    return { angemeldet: !!state.user };
  },
  head: () => ({ meta: [{ title: "KI-Assistent verbinden · Haben" }] }),
  component: ZustimmungsSeite,
});

/** Anmeldung mit Rückkehr auf diese Seite samt unveränderter Anfrage */
const zurAnmeldung = () => `/login?weiter=${encodeURIComponent(window.location.pathname + window.location.search)}`;

function ZustimmungsSeite() {
  const { angemeldet } = Route.useRouteContext();
  const [anfrage, setAnfrage] = useState<Anfrage | null>(null);
  const [ansicht, setAnsicht] = useState<Ansicht | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nur einmal beim Öffnen prüfen
  useEffect(() => {
    if (!angemeldet) {
      window.location.replace(zurAnmeldung());
      return;
    }
    const { search } = window.location;
    const roh = new URLSearchParams(search);
    const daten = Object.fromEntries(PARAMETER.flatMap((name) => (roh.has(name) ? [[name, roh.get(name)!]] : [])));
    setAnfrage(daten);
    getOAuthConsent({ data: daten })
      .then((ergebnis) => {
        if (ergebnis.kind === "zurueck") window.location.replace(ergebnis.url);
        else if (ergebnis.kind === "fehler") setError(ergebnis.message);
        else setAnsicht(ergebnis);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  /** Für das Zulassen braucht es eine frische Anmeldung: abmelden und über die Anmeldung hierher zurück */
  async function erneutAnmelden() {
    setBusy(true);
    // Erst hier laden: der Auth-Client bringt den Passkey-Code mit
    const { authClient } = await import("../../lib/auth-client.ts");
    await authClient.signOut();
    window.location.assign(zurAnmeldung());
  }

  async function entscheiden(approve: boolean) {
    if (!anfrage) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await decideOAuthConsent({ data: { ...anfrage, approve } });
      window.location.assign(url);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="card auth-card stack">
        <div className="brand" style={{ color: "var(--ink)", padding: 0 }}>
          <span className="brand-mark">H</span>Haben
        </div>
        <h1 style={{ fontSize: 24 }}>KI-Assistent verbinden</h1>
        {ansicht && (
          <>
            {/* Den Namen wählt der Client bei der Registrierung selbst; er belegt nicht, wer dahintersteht */}
            <p style={{ margin: 0 }}>
              Ein KI-Assistent möchte deine Buchhaltung in Haben lesen. Er nennt sich „{ansicht.clientName}“. Nach der Zustimmung geht es zurück zu{" "}
              <strong>{ansicht.redirectHost}</strong>.
            </p>
            <p style={{ margin: 0 }}>
              <strong>Nur zulassen, wenn du diese Verbindung gerade selbst eingerichtet hast.</strong>
            </p>
            <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Nur lesen: Buchen, Festschreiben und Senden an ELSTER bleiben bei dir in Haben.</li>
              <li>Jeder Aufruf steht unter Einstellungen → KI-Assistenten und API; dort kannst du die Verbindung jederzeit widerrufen.</li>
            </ul>
            {!ansicht.fresh && <p style={{ margin: 0 }}>Zum Zulassen melde dich bitte erneut an; danach kommst du hierher zurück.</p>}
            <div className="actions">
              <button type="button" className="btn" onClick={() => void entscheiden(false)} disabled={busy}>
                Ablehnen
              </button>
              {ansicht.fresh ? (
                <button type="button" className="btn btn-primary" onClick={() => void entscheiden(true)} disabled={busy}>
                  Zulassen
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => void erneutAnmelden()} disabled={busy}>
                  Erneut anmelden
                </button>
              )}
            </div>
          </>
        )}
        {!ansicht && !error && <p className="muted">Anfrage wird geprüft …</p>}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
