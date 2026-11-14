import type { FormEvent } from "react";
import { authClient } from "../lib/auth-client.ts";
import { useAction } from "../lib/use-action.ts";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

const errorMessages: Partial<Record<string, string>> = {
  INVALID_PASSWORD: "Das bisherige Passwort stimmt nicht.",
  PASSWORD_TOO_SHORT: "Das neue Passwort muss mindestens 12 Zeichen lang sein.",
  PASSWORD_TOO_LONG: "Das neue Passwort darf höchstens 128 Zeichen lang sein.",
  PASSWORD_UNCHANGED: "Wähle ein anderes neues Passwort.",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "Für dieses Konto ist kein Passwort hinterlegt.",
};

export function PasswordCard() {
  const { busy, notice, run } = useAction();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    await run(async () => {
      const { error } = await authClient.changePassword({
        currentPassword: String(values.get("currentPassword")),
        newPassword: String(values.get("newPassword")),
        revokeOtherSessions: true,
      });
      if (error) {
        if (error.status === 401) throw new Error("Bitte erneut anmelden.");
        throw new Error(errorMessages[error.code ?? ""] ?? "Das Passwort konnte nicht geändert werden.");
      }
      form.reset();
    }, "Passwort geändert. Andere Sitzungen wurden abgemeldet.");
  }

  return (
    <section className="card" aria-labelledby="password-heading">
      <h2 id="password-heading">Passwort ändern</h2>
      <p className="small muted">Beim Ändern des Passworts werden alle anderen Sitzungen abgemeldet.</p>
      <form method="post" onSubmit={onSubmit}>
        <div className="stack">
          <Field label="Bisheriges Passwort">
            {(control) => <input {...control} name="currentPassword" type="password" autoComplete="current-password" required />}
          </Field>
          <Field label="Neues Passwort" hint="Mindestens 12 Zeichen.">
            {(control) => <input {...control} name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />}
          </Field>
        </div>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Passwort ändern
          </button>
        </div>
      </form>
      <NoticeBanner notice={notice} />
    </section>
  );
}
