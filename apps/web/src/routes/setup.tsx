import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { authClient } from "../lib/auth-client.ts";
import { errorMessage } from "../lib/format.ts";
import { getAuthState } from "../server/functions/setup.ts";

export const Route = createFileRoute("/setup")({
  beforeLoad: async () => {
    const state = await getAuthState();
    if (state.initialized && !state.user) throw redirect({ to: "/login" });
    return { state };
  },
  head: () => ({ meta: [{ title: "Einrichtung · Haben" }] }),
  component: SetupPage,
});

function SetupPage() {
  const { state } = Route.useRouteContext();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { error } = await authClient.signUp.email({
        name: String(form.get("name")),
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      if (error) setError(error.message ?? "Konto konnte nicht angelegt werden.");
      else await router.invalidate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function addPasskey() {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.passkey.addPasskey({ name: "Haben" });
      if (result?.error) throw new Error(result.error.message);
      await router.navigate({ to: "/einstellungen" });
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
        {state.user ? (
          <>
            <h1 style={{ fontSize: 22 }}>Passkey einrichten</h1>
            <p className="muted">
              Melde dich künftig mit einem Passkey an, ohne Passwort. Das Passwort bleibt als Rückfallebene.
            </p>
            <button type="button" className="btn btn-primary" onClick={addPasskey} disabled={busy}>
              Passkey hinzufügen
            </button>
            <button type="button" className="btn" onClick={() => router.navigate({ to: "/einstellungen" })}>
              Später
            </button>
          </>
        ) : (
          <form className="stack" onSubmit={createAccount}>
            <h1 style={{ fontSize: 22 }}>Haben einrichten</h1>
            <p className="muted" style={{ margin: 0 }}>
              Haben hat genau ein Konto. Nach dem Anlegen fügst du einen Passkey hinzu.
            </p>
            <label className="field">
              Name
              <input name="name" required autoComplete="name" />
            </label>
            <label className="field">
              E-Mail
              <input name="email" type="email" required autoComplete="email" />
            </label>
            <label className="field">
              Passwort (mindestens 12 Zeichen)
              <input name="password" type="password" required minLength={12} autoComplete="new-password" />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Konto anlegen
            </button>
          </form>
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
