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
    const values = new FormData(event.currentTarget);
    const newPassword = String(values.get("newPassword"));
    await run(async () => {
      if (newPassword !== values.get("confirmPassword")) throw new Error("Die neuen Passwörter stimmen nicht überein.");
      const { error } = await authClient.changePassword({
        currentPassword: String(values.get("currentPassword")),
        newPassword,
        revokeOtherSessions: true,
      });
      if (error) {
        if (error.status === 401) throw new Error("Bitte erneut anmelden.");
        throw new Error(errorMessages[error.code ?? ""] ?? "Das Passwort konnte nicht geändert werden.");
      }
      window.location.assign("/login");
    });
  }

  return (
    <section className="card" aria-labelledby="password-heading">
      <h2 id="password-heading">Passwort ändern</h2>
      <p className="small muted">Beim Ändern des Passworts wirst du auf allen Geräten abgemeldet, auch in diesem Browser.</p>
      <form className="stack" method="post" onSubmit={onSubmit}>
        <Field label="Bisheriges Passwort">
          {(control) => <input {...control} name="currentPassword" type="password" autoComplete="current-password" required />}
        </Field>
        <Field label="Neues Passwort" hint="Mindestens 12 Zeichen.">
          {(control) => <input {...control} name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />}
        </Field>
        <Field label="Neues Passwort bestätigen">
          {(control) => <input {...control} name="confirmPassword" type="password" autoComplete="new-password" required />}
        </Field>
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
