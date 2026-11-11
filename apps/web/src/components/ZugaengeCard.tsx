import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../lib/format.ts";
import { ROLLEN_LABEL } from "../lib/rollen.ts";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { changeAccountFn, createInvitationFn, revokeInvitationFn, type getZugaenge } from "../server/functions/zugang.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";

type Data = Extract<Awaited<ReturnType<typeof getZugaenge>>, { mode: "lokal" }>;

const INVITATION_STATUS = {
  offen: { label: "offen", pill: "pill-info" },
  eingeloest: { label: "eingelöst", pill: "pill-ok" },
  zurueckgezogen: { label: "zurückgezogen", pill: "" },
  abgelaufen: { label: "abgelaufen", pill: "pill-warn" },
} as const;

export const STEUERBERATUNG_DOCS = "https://haben.app/steuerberatung.html";

/** Einstellungen → Sicherheit: Zugänge mit Rolle, Einladung für die Steuerberatung, Sperren und Entfernen */
export function ZugaengeCard({ data }: { data: Data }) {
  const router = useRouter();
  const create = useServerFn(createInvitationFn);
  const revoke = useServerFn(revokeInvitationFn);
  const change = useServerFn(changeAccountFn);
  const { busy, notice, run } = useAction();
  const [created, setCreated] = useState<{ label: string; url: string; expiresAt: Date } | null>(null);
  const [copied, setCopied] = useState(false);
  /** Der Zugang, nach dessen Entfernen der Dialog gerade fragt */
  const [removing, setRemoving] = useState<(typeof data.accounts)[number] | null>(null);

  function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const label = String(new FormData(form).get("label") ?? "").trim();
    void run(async () => {
      const { url, expiresAt } = await create({ data: { label } });
      setCopied(false);
      setCreated({ label, url, expiresAt: new Date(expiresAt) });
      form.reset();
      await router.invalidate();
    });
  }

  const act = (userId: string, action: "sperren" | "entsperren" | "entfernen", success: string) =>
    void run(async () => {
      await change({ data: { userId, action } });
      await router.invalidate();
    }, success);

  const open = data.invitations.filter((i) => i.status === "offen");
  const history = data.invitations.filter((i) => i.status !== "offen").slice(0, 10);

  return (
    <section className="card" aria-labelledby="zugaenge-heading">
      <h2 id="zugaenge-heading">Zugänge</h2>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        Deine Steuerberatung bekommt einen eigenen Zugang, der nur lesen kann: Auswertungen, Journal, Kontenblätter, Belege und Rechnungen ansehen, Dateien,
        DATEV-Export und Jahresarchiv herunterladen. Buchen, Festschreiben, Ändern, Senden an ELSTER, Einstellungen, Zertifikat, Bankzugang und API-Tokens
        bleiben bei dir. Jede Anmeldung steht im Änderungsprotokoll.{" "}
        <a href={STEUERBERATUNG_DOCS} target="_blank" rel="noreferrer">
          Mehr dazu
        </a>
      </p>

      {data.accounts.map((account) => (
        <div key={account.id} className="history-row">
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontWeight: 500, overflowWrap: "anywhere" }}>
              {account.name} {account.role && <span className="pill">{ROLLEN_LABEL[account.role]}</span>}
              {account.lockedAt && <span className="pill pill-warn">gesperrt</span>}
            </span>
            <span className="small muted" style={{ overflowWrap: "anywhere" }}>
              {account.email} · {account.lastLoginAt ? `zuletzt angemeldet ${formatDateTime(account.lastLoginAt)}` : "noch nicht angemeldet"}
            </span>
          </div>
          {account.role === "steuerberatung" && (
            <div className="actions">
              {account.lockedAt ? (
                <button type="button" className="btn" disabled={busy} onClick={() => act(account.id, "entsperren", `${account.name} wieder freigegeben.`)}>
                  Freigeben
                </button>
              ) : (
                <button type="button" className="btn" disabled={busy} onClick={() => act(account.id, "sperren", `${account.name} gesperrt.`)}>
                  Sperren
                </button>
              )}
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                aria-label={`Zugang ${account.name} entfernen`}
                onClick={() => setRemoving(account)}
              >
                Entfernen
              </button>
            </div>
          )}
        </div>
      ))}

      <ConfirmDialog
        open={removing !== null}
        title={`Zugang ${removing?.name} entfernen?`}
        confirmLabel="Entfernen"
        danger
        onConfirm={() => removing && act(removing.id, "entfernen", `Zugang ${removing.name} entfernt.`)}
        onClose={() => setRemoving(null)}
      >
        <p>Der Zugang wird mit Passwort, Passkeys und Sitzungen gelöscht. Name, E-Mail und Rolle bleiben im Änderungsprotokoll.</p>
      </ConfirmDialog>

      <h3 style={{ margin: "8px 0 0", fontSize: 16 }}>Steuerberatung einladen</h3>
      {created && (
        <div className="stack" style={{ gap: 8 }}>
          <Field
            label={
              <>
                Einladungslink für „{created.label}“ (wird nur jetzt angezeigt, gültig bis {formatDateTime(created.expiresAt)})
              </>
            }
          >
            {(control) => <input {...control} readOnly className="mono" value={created.url} onFocus={(e) => e.currentTarget.select()} />}
          </Field>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => void navigator.clipboard?.writeText(created.url).then(() => setCopied(true))}>
              {copied ? "Kopiert" : "Link kopieren"}
            </button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Schick den Link auf einem sicheren Weg. Er gilt einmal und {data.gueltigStunden} Stunden; wer ihn hat, legt damit den Zugang an.
          </p>
        </div>
      )}
      {open.map((invitation) => (
        <div key={invitation.id} className="history-row">
          <span className="small" style={{ overflowWrap: "anywhere" }}>
            {invitation.label} <span className={`pill ${INVITATION_STATUS.offen.pill}`}>offen</span>
            <span className="small muted" style={{ display: "block" }}>
              gültig bis {formatDateTime(invitation.expiresAt)}
            </span>
          </span>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await revoke({ data: invitation.id });
                await router.invalidate();
              }, "Einladung zurückgezogen.")
            }
          >
            Zurückziehen
          </button>
        </div>
      ))}
      <form className="form-grid" onSubmit={onInvite} aria-label="Neue Einladung">
        <Field label="Bezeichnung">{(control) => <input {...control} name="label" required maxLength={80} placeholder="Kanzlei Muster" />}</Field>
        <div className="actions" style={{ alignSelf: "end" }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Einladungslink erzeugen
          </button>
        </div>
      </form>
      {history.length > 0 && (
        <details>
          <summary className="small">Frühere Einladungen</summary>
          {history.map((invitation) => (
            <div key={invitation.id} className="history-row small">
              <span style={{ overflowWrap: "anywhere" }}>
                {invitation.label}
                {invitation.acceptedEmail ? ` · ${invitation.acceptedEmail}` : ""}
              </span>
              <span className={`pill ${INVITATION_STATUS[invitation.status].pill}`}>{INVITATION_STATUS[invitation.status].label}</span>
            </div>
          ))}
        </details>
      )}
      <NoticeBanner notice={notice} />
    </section>
  );
}
