import { PASSKEY_ERROR_CODES } from "@better-auth/passkey/client";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { SsoSignIn } from "../components/SsoSignIn.tsx";
import { authClient } from "../lib/auth-client.ts";
import { errorMessage } from "../lib/format.ts";
import { getAuthState } from "../server/functions/setup.ts";
import { Field } from "../components/Field.tsx";

export const Route = createFileRoute("/login")({
  beforeLoad: async ({ location }) => {
    const state = await getAuthState();
    // Den Hinweis eines abgewiesenen SSO-Callbacks (?sso=…) mitnehmen
    if (!state.initialized) throw redirect({ href: `/setup${location.searchStr}` });
    if (state.user) throw redirect({ to: "/" });
    return { oidc: state.oidc };
  },
  head: () => ({ meta: [{ title: "Anmelden · Haben" }] }),
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const { oidc } = Route.useRouteContext();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Autofill nur einmal beim Öffnen des Formulars anbieten
  useEffect(() => {
    // Passkey-Autofill braucht ein Feld mit autocomplete="webauthn", das gibt es erst im Passwort-Formular
    if (oidc.only || !showPassword) return;
    if (typeof PublicKeyCredential !== "undefined" && PublicKeyCredential.isConditionalMediationAvailable) {
      void PublicKeyCredential.isConditionalMediationAvailable().then((available) => {
        if (!available) return;
        // Ein Abbruch ist kein Fehler: Das Autofill läuft im Hintergrund, und der Passkey-Knopf beendet es selbst.
        // Lehnt der Server einen gewählten Passkey ab, soll man das aber sehen. @better-auth/passkey meldet jeden
        // Abbruch im Browser mit dieser Meldung, der Server mit seiner eigenen (z. B. PASSKEY_NOT_FOUND)
        void authClient.signIn.passkey({ autoFill: true }).then((result) => {
          if (result?.error?.message !== PASSKEY_ERROR_CODES.AUTH_CANCELLED.message) void onResult(result);
        });
      });
    }
  }, [showPassword]);

  async function onResult(result: { error?: { message?: string } | null } | undefined) {
    if (result?.error) setError(result.error.message ?? "Anmeldung fehlgeschlagen.");
    else await router.navigate({ to: "/" });
  }

  async function withPasskey() {
    setBusy(true);
    setError(null);
    try {
      await onResult(await authClient.signIn.passkey());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function withPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await onResult(await authClient.signIn.email({ email: String(form.get("email")), password: String(form.get("password")) }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="card auth-card">
        <div className="brand" style={{ color: "var(--ink)", padding: 0 }}>
          <span className="brand-mark">H</span>Haben
        </div>
        <h1 style={{ fontSize: 24 }}>Anmelden</h1>
        {oidc.only ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Haben nutzt ausschließlich {oidc.name}. Deine Berechtigung wird bei jeder Anmeldung und spätestens nach 15 Minuten neu bestätigt.
            </p>
            <SsoSignIn name={oidc.name} />
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={withPasskey} disabled={busy}>
              Mit Passkey anmelden
            </button>
            {showPassword ? (
              <form className="stack" onSubmit={withPassword}>
                <Field label="E-Mail">
                  {(control) => <input {...control} name="email" type="email" required autoComplete="username webauthn" autoFocus />}
                </Field>
                <Field label="Passwort">{(control) => <input {...control} name="password" type="password" required autoComplete="current-password" />}</Field>
                <button type="submit" className="btn" disabled={busy}>
                  Mit Passwort anmelden
                </button>
              </form>
            ) : (
              <button type="button" className="btn" onClick={() => setShowPassword(true)}>
                Passwort verwenden
              </button>
            )}
          </>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
