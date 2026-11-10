import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { authClient } from "../lib/auth-client.ts";
import { errorMessage, formatDateTime } from "../lib/format.ts";
import { getAuthState } from "../server/functions/setup.ts";
import { checkInvitation } from "../server/functions/zugang.ts";
import { Field } from "../components/Field.tsx";

/** Einladung der Steuerberatung einlösen: Konto mit Passwort anlegen, danach Passkey hinzufügen */
export const Route = createFileRoute("/einladung/$token")({
  beforeLoad: async ({ params }) => {
    const [state, invitation] = await Promise.all([getAuthState(), checkInvitation({ data: params.token })]);
    return { state, invitation };
  },
  head: () => ({ meta: [{ title: "Einladung · Haben" }] }),
  component: InvitationPage,
});

function InvitationPage() {
  const { state, invitation } = Route.useRouteContext();
  const { token } = Route.useParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);

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
        fetchOptions: { headers: { "x-haben-einladung": token } },
      });
      if (error) setError(error.message ?? "Der Zugang konnte nicht angelegt werden.");
      else setAccepted(true);
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
      await router.navigate({ to: "/steuerberatung" });
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
        {accepted ? (
          <>
            <h1 style={{ fontSize: 24 }}>Passkey einrichten</h1>
            <p className="muted">Melde dich künftig mit einem Passkey an, ohne Passwort. Das Passwort bleibt als Rückfallebene.</p>
            <button type="button" className="btn btn-primary" onClick={addPasskey} disabled={busy}>
              Passkey hinzufügen
            </button>
            <button type="button" className="btn" onClick={() => router.navigate({ to: "/steuerberatung" })}>
              Später
            </button>
          </>
        ) : state.user ? (
          <>
            <h1 style={{ fontSize: 24 }}>Einladung</h1>
            <p className="muted" style={{ margin: 0 }}>
              Du bist schon als {state.user.name} angemeldet. Melde dich ab, um mit dieser Einladung einen eigenen Zugang anzulegen.
            </p>
          </>
        ) : invitation.unavailable ? (
          <>
            <h1 style={{ fontSize: 24 }}>Einladungen nicht verfügbar</h1>
            <p className="muted" style={{ margin: 0 }}>
              Haben nutzt ausschließlich SSO. Zugänge vergibt der Betreiber über die Gruppen im Anmeldedienst; danach genügt die Anmeldung.
            </p>
            <a className="btn btn-primary" href="/login">
              Zur Anmeldung
            </a>
          </>
        ) : invitation.valid ? (
          <form className="stack" onSubmit={createAccount}>
            <h1 style={{ fontSize: 24 }}>Zugang für die Steuerberatung</h1>
            <p className="muted" style={{ margin: 0 }}>
              Einladung „{invitation.label}“, gültig bis {formatDateTime(invitation.expiresAt)}. Der Zugang kann alles ansehen und herunterladen, aber nichts
              ändern.
            </p>
            <Field label="Name">{(control) => <input {...control} name="name" required autoComplete="name" />}</Field>
            <Field label="E-Mail">{(control) => <input {...control} name="email" type="email" required autoComplete="email" />}</Field>
            <Field label="Passwort (mindestens 12 Zeichen)">
              {(control) => <input {...control} name="password" type="password" required minLength={12} autoComplete="new-password" />}
            </Field>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Zugang anlegen
            </button>
          </form>
        ) : (
          <>
            <h1 style={{ fontSize: 24 }}>Einladung ungültig</h1>
            <p className="muted" style={{ margin: 0 }}>
              Dieser Link ist abgelaufen, schon eingelöst oder zurückgezogen. Bitte den Inhaber um eine neue Einladung.
            </p>
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
