import { type ExpenseCategory, type Kontenrahmen, ownAccountProblem } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useAction } from "../lib/use-action.ts";
import { archiveOwnAccountFn, createOwnAccountFn, deleteOwnAccountFn, type getOwnAccounts, renameOwnAccountFn } from "../server/functions/eigene-konten.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

type Overview = Awaited<ReturnType<typeof getOwnAccounts>>;
type Row = Overview["accounts"][number];
type Run = ReturnType<typeof useAction>["run"];

/**
 * Eigene Sachkonten (#270): ein Aufwandskonto mit eigener Nummer und eigenem Namen, das für Steuer und EÜR wie seine
 * Elternkategorie zählt. Am Beleg und an einer Zeile der Aufteilung wählt man es statt des Kontos der Kategorie. Die Regel für
 * die Nummer ist dieselbe wie im Server (ownAccountProblem); der Server prüft zusätzlich, ob das Journal die Nummer schon kennt.
 */
export function OwnAccountsCard({ overview }: { overview: Overview }) {
  const router = useRouter();
  const remove = useServerFn(deleteOwnAccountFn);
  const { busy, notice, run } = useAction();
  const [confirm, setConfirm] = useState<Row | null>(null);
  const active = overview.accounts.filter((a) => !a.archived);
  const archived = overview.accounts.filter((a) => a.archived);
  const row = (a: Row) => <OwnAccountRow key={a.id} account={a} busy={busy} run={run} onDelete={() => setConfirm(a)} />;

  return (
    <section className="card stack" aria-label="Eigene Konten">
      <h2 style={{ margin: 0 }}>Eigene Konten</h2>
      <p className="muted small" style={{ margin: 0, maxWidth: 720 }}>
        Ein Aufwandskonto mit eigener Nummer und eigenem Namen, etwa „4999 Software: Entwicklung“. Es zählt für Umsatzsteuer, EÜR und Bilanz wie seine
        Elternkategorie; die Steuerberatung bekommt im DATEV-Export die eigene Nummer. Am Beleg wählst du es bei der Kategorie, bei einem aufgeteilten Beleg je
        Zeile. Eine Nummer lässt sich nach der ersten Buchung nicht mehr ändern.
      </p>
      <NoticeBanner notice={notice} />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? `Konto ${confirm.account} löschen?` : "Konto löschen?"}
        facts={
          confirm
            ? [
                { label: "Konto", value: `${confirm.account} ${confirm.name}`, strong: true },
                { label: "Elternkategorie", value: confirm.parentLabel },
              ]
            : undefined
        }
        confirmLabel="Löschen"
        danger
        onConfirm={() =>
          confirm &&
          void run(async () => {
            await remove({ data: { id: confirm.id } });
            await router.invalidate();
          }, `Konto ${confirm.account} gelöscht.`)
        }
        onClose={() => setConfirm(null)}
      >
        <p>Das Konto wird gelöscht. Wird es schon in einem Beleg oder im Journal verwendet, geht das nicht; dann bleibt nur, es zu archivieren.</p>
      </ConfirmDialog>
      <NewOwnAccountForm overview={overview} busy={busy} run={run} />
      {overview.accounts.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Noch keine eigenen Konten.
        </p>
      ) : (
        <div className="table" role="group" aria-label="Eigene Konten der Firma">
          <div className="table-row head own-account-cols">
            <div>Nummer</div>
            <div>Name</div>
            <div>Elternkategorie</div>
            <div />
          </div>
          {active.map(row)}
          {archived.length > 0 && (
            <>
              <div className="small muted" style={{ padding: "8px 12px 0" }}>
                Archiviert: nicht mehr zur Auswahl, Belege darauf bleiben.
              </div>
              {archived.map(row)}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Neues Konto: Elternkategorie, Nummer, Name; der Fehler der Regel steht am Feld der Nummer, erst wenn etwas eingegeben ist */
function NewOwnAccountForm({ overview, busy, run }: { overview: Overview; busy: boolean; run: Run }) {
  const router = useRouter();
  const create = useServerFn(createOwnAccountFn);
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [parent, setParent] = useState<ExpenseCategory | "">("");
  const kontenrahmen: Kontenrahmen = overview.kontenrahmen;
  const parentInfo = overview.parents.find((p) => p.value === parent);
  const started = account !== "" || name !== "";
  const problem = parent === "" ? null : ownAccountProblem({ kontenrahmen, account, name, parentCategory: parent });

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    if (parent === "") return;
    const ok = await run(async () => {
      await create({ data: { account, name, parentCategory: parent } });
      await router.invalidate();
    }, `Konto ${account} angelegt.`);
    if (ok) {
      setAccount("");
      setName("");
    }
  }

  return (
    <form className="stack" aria-label="Neues Konto" onSubmit={onCreate}>
      <div className="form-row cols-3">
        <Field label="Elternkategorie" hint={parentInfo ? `Die Nummer liegt im Bereich von ${parentInfo.account}.` : "Daran hängen Umsatzsteuer und EÜR."}>
          {(control) => (
            <select {...control} value={parent} onChange={(e) => setParent(e.target.value as ExpenseCategory | "")} required>
              <option value="" disabled>
                Bitte wählen
              </option>
              {overview.parents.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Kontonummer" hint="Vier Ziffern." error={started && problem ? problem : undefined}>
          {(control) => (
            <input
              {...control}
              className="mono"
              inputMode="numeric"
              maxLength={4}
              value={account}
              onChange={(e) => setAccount(e.target.value.trim())}
              required
            />
          )}
        </Field>
        <Field label="Name">{(control) => <input {...control} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || parent === "" || problem !== null}>
          Konto anlegen
        </button>
      </div>
    </form>
  );
}

/** Eine Zeile der Liste: Nummer, Name (zum Umbenennen ein Feld), Elternkategorie und die Aktionen */
function OwnAccountRow({ account: a, busy, run, onDelete }: { account: Row; busy: boolean; run: Run; onDelete: () => void }) {
  const router = useRouter();
  const rename = useServerFn(renameOwnAccountFn);
  const archive = useServerFn(archiveOwnAccountFn);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="table-row own-account-cols">
      <div className="mono">{a.account}</div>
      <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {editing !== null ? (
          <form
            className="actions own-account-rename"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await rename({ data: { id: a.id, name: editing } });
                setEditing(null);
                await router.invalidate();
              }, "Name geändert.");
            }}
          >
            <input aria-label={`Name von Konto ${a.account}`} value={editing} maxLength={80} onChange={(e) => setEditing(e.target.value)} autoFocus />
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
              Speichern
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>
              Abbrechen
            </button>
          </form>
        ) : (
          <span style={{ fontWeight: 500 }}>{a.name}</span>
        )}
      </div>
      <div className="muted small">{a.parentLabel}</div>
      <div className="actions" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
        <button type="button" className="btn btn-sm" aria-label={`Konto ${a.account} umbenennen`} onClick={() => setEditing(a.name)}>
          Umbenennen
        </button>
        <button
          type="button"
          className="btn btn-sm"
          aria-label={`Konto ${a.account} ${a.archived ? "wieder aktivieren" : "archivieren"}`}
          disabled={busy}
          onClick={() =>
            void run(
              async () => {
                await archive({ data: { id: a.id, archived: !a.archived } });
                await router.invalidate();
              },
              a.archived ? `Konto ${a.account} ist wieder aktiv.` : `Konto ${a.account} archiviert.`,
            )
          }
        >
          {a.archived ? "Aktivieren" : "Archivieren"}
        </button>
        <button type="button" className="btn btn-sm btn-danger" aria-label={`Konto ${a.account} löschen`} onClick={onDelete}>
          Löschen
        </button>
      </div>
    </div>
  );
}
