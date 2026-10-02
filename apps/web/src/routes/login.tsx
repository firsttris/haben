import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "../lib/auth-client.ts";
import { errorMessage } from "../lib/format.ts";
import { getAuthState } from "../server/functions/setup.ts";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const state = await getAuthState();
    if (!state.initialized) throw redirect({ to: "/setup" });
    if (state.user) throw redirect({ to: "/" });
  },
  head: () => ({ meta: [{ title: "Anmelden · Haben" }] }),
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    // Passkey-Autofill im Browser anbieten
    if (typeof PublicKeyCredential !== "undefined" && PublicKeyCredential.isConditionalMediationAvailable) {
      void PublicKeyCredential.isConditionalMediationAvailable().then((available) => {
        if (available) void authClient.signIn.passkey({ autoFill: true }).then(onResult);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    await onResult(
      await authClient.signIn.email({ email: String(form.get("email")), password: String(form.get("password")) }),
    );
    setBusy(false);
  }

  return (
    <main className="auth-page">
      <div className="card auth-card">
        <div className="brand" style={{ color: "var(--ink)", padding: 0 }}>
          <span className="brand-mark">H</span>Haben
        </div>
        <h1 style={{ fontSize: 22 }}>Anmelden</h1>
        <button type="button" className="btn btn-primary" onClick={withPasskey} disabled={busy}>
          Mit Passkey anmelden
        </button>
        {showPassword ? (
          <form className="stack" onSubmit={withPassword}>
            <label className="field">
              E-Mail
              <input name="email" type="email" required autoComplete="username webauthn" />
            </label>
            <label className="field">
              Passwort
              <input name="password" type="password" required autoComplete="current-password" />
            </label>
            <button type="submit" className="btn" disabled={busy}>
              Mit Passwort anmelden
            </button>
          </form>
        ) : (
          <button type="button" className="btn btn-dashed" onClick={() => setShowPassword(true)}>
            Passwort verwenden
          </button>
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
