import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../lib/format.ts";
import { useAction, type Notice } from "../lib/use-action.ts";
import { deliverArchiveNow, removeArchiveTarget, saveArchiveTargetFn } from "../server/functions/ablage.ts";
import type { archiveTargetOverview } from "../server/modules/ablage/index.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";
import { Icon } from "./Icon.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

type Data = Awaited<ReturnType<typeof archiveTargetOverview>>;

/** Höchstens so viele Zusatzfelder (archiveTargetSchema) */
const MAX_FELDER = 10;

let nextKey = 1;

/** Ablage im Dokumentenarchiv: wohin Haben festgeschriebene Rechnungen schickt */
export function ArchiveTargetCard({ data }: { data: Data }) {
  const router = useRouter();
  const save = useServerFn(saveArchiveTargetFn);
  const t = data.target;
  const [fields, setFields] = useState(() => (t?.fields ?? []).map((f) => ({ ...f, key: nextKey++ })));
  const action = useAction();
  const { busy, notice } = action;

  const run = (work: () => Promise<Notice>) =>
    action.run(async () => {
      action.setNotice(await work());
      await router.invalidate();
    });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    void run(async () => {
      await save({
        data: {
          url: text("url"),
          fileField: text("fileField"),
          headerName: text("headerName"),
          headerValue: String(form.get("headerValue") ?? "") || undefined,
          fields: fields.filter((f) => f.name.trim() || f.value.trim()).map(({ name, value }) => ({ name: name.trim(), value })),
          file: form.get("file") === "pdf" ? "pdf" : "original",
          linkTemplate: text("linkTemplate"),
          enabled: form.get("enabled") === "on",
        },
      });
      element.querySelector<HTMLInputElement>("input[name=headerValue]")!.value = "";
      return { tone: "ok", text: "Ablage gespeichert." };
    });
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="ablage-heading">
      <h2 id="ablage-heading">Ablage im Dokumentenarchiv</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Haben schickt jede festgeschriebene Rechnung, Stornorechnung und Korrektur einmal als Kopie an eine Adresse, die Dateien per Formular annimmt, etwa ein
        Dokumentenarchiv. Das Original bleibt in Haben. Gesendet wird alles, was ab dem Einschalten festgeschrieben wird.
      </p>
      <TargetInputs target={t} />
      <ExtraFields fields={fields} onChange={setFields} platzhalter={data.platzhalter} />
      <TargetFileInputs target={t} />
      <label className="checkbox">
        <input type="checkbox" name="enabled" defaultChecked={t?.enabled ?? true} />
        Festgeschriebene Rechnungen übertragen
      </label>
      <TargetActions target={t} busy={busy} run={run} />
      <NoticeBanner notice={notice} />
      {t?.lastRunAt && (
        <p className="small muted" style={{ margin: 0 }}>
          Zuletzt übertragen {formatDateTime(t.lastRunAt)}
        </p>
      )}
      <FailedDeliveries failed={data.failed} />
    </form>
  );
}

type Target = Data["target"];
type Extra = { key: number; name: string; value: string };

function TargetInputs({ target: t }: { target: Target }) {
  return (
    <>
      <Field label="Adresse" hint="Die Adresse zum Hochladen, z. B. https://archiv.example/api/dokumente">
        {(control) => <input {...control} name="url" type="url" defaultValue={t?.url ?? ""} placeholder="https://" required />}
      </Field>
      <div className="form-row cols-3">
        <Field label="Feld für die Datei">{(control) => <input {...control} name="fileField" defaultValue={t?.fileField ?? "datei"} required />}</Field>
        <Field label="Kopfzeile">
          {(control) => <input {...control} name="headerName" defaultValue={t?.headerName ?? "Authorization"} autoComplete="off" />}
        </Field>
        <Field label="Wert der Kopfzeile">
          {(control) => (
            <input
              {...control}
              name="headerValue"
              type="password"
              autoComplete="new-password"
              placeholder={t?.headerSet ? "unverändert lassen" : "z. B. Bearer …"}
            />
          )}
        </Field>
      </div>
    </>
  );
}

function TargetFileInputs({ target: t }: { target: Target }) {
  return (
    <div className="form-row cols-2">
      <Field label="Datei">
        {(control) => (
          <select {...control} name="file" defaultValue={t?.file ?? "original"}>
            <option value="original">E-Rechnung im Original (ZUGFeRD-PDF oder XRechnung-XML)</option>
            <option value="pdf">Immer das PDF</option>
          </select>
        )}
      </Field>
      <Field label="Link zum Dokument (optional)" hint="Mit {id} aus der Antwort des Archivs">
        {(control) => (
          <input {...control} name="linkTemplate" type="url" defaultValue={t?.linkTemplate ?? ""} placeholder="https://archiv.example/dokumente/{id}" />
        )}
      </Field>
    </div>
  );
}

/** Feste Zusatzfelder mit Platzhaltern, etwa ein Titel aus Art und Nummer */
function ExtraFields({ fields, onChange, platzhalter }: { fields: Extra[]; onChange: (fields: Extra[]) => void; platzhalter: Data["platzhalter"] }) {
  const update = (key: number, patch: { name?: string; value?: string }) => onChange(fields.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }} aria-describedby="ablage-felder-hint">
      <legend style={{ padding: 0, marginBottom: 8, fontWeight: 600 }}>Zusatzfelder</legend>
      {fields.map((field, index) => (
        <div key={field.key} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label={`Feld ${index + 1}: Name`} style={{ flex: "1 1 140px" }}>
            {(control) => <input {...control} value={field.name} placeholder="title" onChange={(e) => update(field.key, { name: e.target.value })} />}
          </Field>
          <Field label={`Feld ${index + 1}: Wert`} style={{ flex: "2 1 220px" }}>
            {(control) => (
              <input {...control} value={field.value} placeholder="{art} {nummer}" onChange={(e) => update(field.key, { value: e.target.value })} />
            )}
          </Field>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Feld ${index + 1} entfernen`}
            onClick={() => onChange(fields.filter((f) => f.key !== field.key))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
      {fields.length < MAX_FELDER && (
        <div>
          <button type="button" className="btn btn-dashed" onClick={() => onChange([...fields, { key: nextKey++, name: "", value: "" }])}>
            <Icon name="plus" size={16} /> Feld hinzufügen
          </button>
        </div>
      )}
      <span id="ablage-felder-hint" className="small muted">
        Platzhalter im Wert:{" "}
        {Object.entries(platzhalter).map(([key, label], i) => (
          <span key={key}>
            {i > 0 && ", "}
            <code>{`{${key}}`}</code> {label}
          </span>
        ))}
        .
      </span>
    </fieldset>
  );
}

function FailedDeliveries({ failed }: { failed: Data["failed"] }) {
  if (failed.length === 0) return null;
  return (
    <ul className="small muted" style={{ margin: 0, paddingLeft: 20 }}>
      {failed.map((f) => (
        <li key={f.invoiceId} style={{ overflowWrap: "anywhere" }}>
          <Link to="/rechnungen/$id" params={{ id: f.invoiceId }}>
            Rechnung {f.number}
          </Link>
          : {f.error} ({f.attempts} {f.attempts === 1 ? "Versuch" : "Versuche"}, zuletzt {formatDateTime(f.lastAttemptAt)})
        </li>
      ))}
    </ul>
  );
}

/** Entfernen, jetzt übertragen und speichern */
function TargetActions({ target: t, busy, run }: { target: Target; busy: boolean; run: (work: () => Promise<Notice>) => Promise<unknown> }) {
  const deliverNow = useServerFn(deliverArchiveNow);
  const remove = useServerFn(removeArchiveTarget);
  const [removing, setRemoving] = useState(false);
  return (
    <>
      <ConfirmDialog
        open={removing}
        title="Ablage entfernen?"
        confirmLabel="Entfernen"
        danger
        onConfirm={() =>
          void run(async () => {
            await remove();
            return { tone: "ok", text: "Ablage entfernt." };
          })
        }
        onClose={() => setRemoving(false)}
      >
        <p>Haben schickt keine Rechnungen mehr und vergisst Adresse und Kopfzeile. Was schon übertragen ist, bleibt im Archiv und an der Rechnung vermerkt.</p>
      </ConfirmDialog>
      <div className="actions" style={{ flexWrap: "wrap" }}>
        {t && (
          <>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setRemoving(true)}>
              Entfernen
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !t.enabled}
              onClick={() =>
                void run(async () => {
                  const r = await deliverNow();
                  return r.uebertragen === 0 && r.fehler === 0
                    ? { tone: "ok", text: "Nichts zu übertragen." }
                    : { tone: r.fehler ? "danger" : "ok", text: `${r.uebertragen} übertragen${r.fehler ? `, ${r.fehler} fehlgeschlagen` : ""}.` };
                })
              }
            >
              Jetzt übertragen
            </button>
          </>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
      </div>
    </>
  );
}
