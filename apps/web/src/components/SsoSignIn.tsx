import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client.ts";

/** Hinweise zu ?sso=… nach einem abgewiesenen Callback; der Grund kommt vom Server, nie mit Details zur Identität */
const ssoReasons = (provider: string): Record<string, string> => ({
  profil: "Die SSO-Anmeldung liefert kein vollständiges Profil mit gültiger E-Mail-Adresse. Bitte den Betreiber fragen.",
  "gruppen-doppelt": "Kein Zugang: Dein Konto gehört beiden Haben-Gruppen an. Bitte die Zuordnung beim Anbieter korrigieren lassen.",
  gruppe: `Kein Zugang: Dein Konto ist in ${provider} keiner Haben-Gruppe eindeutig zugeordnet. Bitte den Betreiber fragen.`,
  "nicht-eingerichtet": "Haben ist noch nicht eingerichtet. Die erste Anmeldung muss ein Inhaber übernehmen.",
  "konto-vorhanden":
    "Zu dieser E-Mail gibt es schon ein Haben-Konto ohne passende SSO-Zuordnung. Der Betreiber kann es mit der SSO-Übernahme ausdrücklich zuordnen.",
  fehler: "Die SSO-Anmeldung ist fehlgeschlagen. Bitte erneut versuchen oder den Betreiber fragen.",
});

export function ssoReasonMessage(search: string, provider: string): string | null {
  const reason = new URLSearchParams(search).get("sso");
  const reasons = ssoReasons(provider);
  return reason ? (reasons[reason] ?? reasons.fehler!) : null;
}

/**
 * Ob die Anmeldung von selbst starten soll: aus dem Portal (#504) mit ?anmelden=sso. Nicht nach einem abgewiesenen
 * Callback (?sso=…), sonst ginge es im Kreis.
 */
export const ssoAutoStart = (search: string): boolean => {
  const params = new URLSearchParams(search);
  return params.get("anmelden") === "sso" && !params.has("sso");
};

/**
 * Einziger Weg hinein im SSO-Modus: startet die Anmeldung beim konfigurierten Anbieter, ohne weitere Angaben. Mit
 * `autoStart` (Login-Seite) startet sie bei ?anmelden=sso von selbst, damit der Wechsel aus dem Portal ohne Klick geht.
 */
export function SsoSignIn({ name, label, autoStart = false }: { name: string; label?: string; autoStart?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  // Erst nach dem Hydrieren lesen, damit Server und Browser dasselbe rendern
  // biome-ignore lint/correctness/useExhaustiveDependencies: start nur einmal beim Öffnen, nicht bei jedem Rendern
  useEffect(() => {
    setReason(ssoReasonMessage(window.location.search, name));
    if (autoStart && ssoAutoStart(window.location.search)) void start();
  }, [name, autoStart]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.signIn.social({ provider: "oidc", callbackURL: "/" });
      // Better Auth begrenzt Anmeldeversuche je Adresse (3 in 10 Sekunden)
      if (result.error)
        setError(result.error.status === 429 ? "Zu viele Anmeldeversuche. Bitte einen Moment warten und erneut versuchen." : ssoReasons(name).fehler!);
    } catch {
      setError(ssoReasons(name).fehler!);
    } finally {
      setBusy(false);
    }
  }

  const message = error ?? reason;
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
        {label ?? `Mit ${name} anmelden`}
      </button>
      {message && (
        <p className="field-error" role="alert">
          {message}
        </p>
      )}
    </>
  );
}
