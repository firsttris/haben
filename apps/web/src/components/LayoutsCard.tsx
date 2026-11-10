import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { BUILTIN_LAYOUTS, LAYOUT_DOCUMENT_LABELS, LAYOUT_DOCUMENT_TYPES, type LayoutDocumentType, type LayoutRef, type LetterheadDesign } from "@haben/core";
import { formatDate } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { assignLayoutFn, reloadLayoutPackages, removeLayout, renameLayoutFn, replaceLayout, uploadLayout } from "../server/functions/layouts.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

export interface LayoutRow {
  id: string;
  name: string;
  art: "beleg" | "mahnung";
  updatedAt: Date | string;
  /** Freigegebene Pakete fehlen im Cache, etwa nach einem Restore */
  packagesMissing: boolean;
}

/** Rückfrage, bevor Haben Pakete aus dem Netz lädt; erst „Pakete laden“ schickt die Freigabe mit */
function PackageDialog({ packages, onConfirm, onClose }: { packages: string[] | null; onConfirm: () => void; onClose: () => void }) {
  return (
    <ConfirmDialog
      open={packages !== null}
      title="Pakete aus dem Netz laden?"
      confirmLabel="Pakete laden und prüfen"
      danger
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>Das Layout importiert diese Typst-Pakete:</p>
      <ul className="mono">
        {packages?.map((spec) => (
          <li key={spec}>{spec}</li>
        ))}
      </ul>
      <p>
        Pakete sind fremder Code. Haben lädt genau diese Versionen einmal und setzt danach ohne Netz. Bestätige nur, wenn du der Vorlage und ihren Paketen
        vertraust. Ändert sich die Vorlage, fragt Haben erneut.
      </p>
    </ConfirmDialog>
  );
}

const ART_LABEL = { beleg: "Belege", mahnung: "Mahnungen" } as const;
const artFor = (type: LayoutDocumentType) => (type === "mahnung" ? "mahnung" : "beleg");
const refValue = (ref: LayoutRef) => `${ref.kind}:${ref.id}`;
const DOWNLOAD = "/api/belegvorlagen";

/** Datei als Text lesen; Typst-Vorlagen sind UTF-8 */
const readText = (file: File) => file.text();

/** Welches Layout welche Belegart bekommt, die eigenen Layouts und was man zum Schreiben eines Layouts braucht */
export function LayoutsCard({ design, layouts }: { design: LetterheadDesign; layouts: LayoutRow[] }) {
  const router = useRouter();
  const assign = useServerFn(assignLayoutFn);
  const { busy, notice, run } = useAction();

  const onAssign = (type: LayoutDocumentType, value: string) =>
    run(async () => {
      const [kind, id] = value.split(":") as [LayoutRef["kind"], string];
      await assign({ data: { type, ref: { kind, id } } });
      await router.invalidate();
    }, "Gespeichert. Gilt für alles, was ab jetzt erzeugt wird.");

  return (
    <section className="card" aria-labelledby="layouts-heading">
      <h2 id="layouts-heading">Layouts</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Jede Belegart hat ihr eigenes Layout, eingebaut oder selbst geschrieben. Ein Wechsel gilt für alles, was ab jetzt erzeugt wird, auch für offene
        Entwürfe; festgeschriebene Belege behalten ihr PDF.
      </p>
      <table className="layouts-table">
        <thead>
          <tr>
            <th scope="col">Belegart</th>
            <th scope="col">Layout</th>
          </tr>
        </thead>
        <tbody>
          {LAYOUT_DOCUMENT_TYPES.map((type) => (
            <tr key={type}>
              <td>{LAYOUT_DOCUMENT_LABELS[type]}</td>
              <td>
                <div className="field">
                  <select
                    aria-label={`Layout für ${LAYOUT_DOCUMENT_LABELS[type]}`}
                    value={refValue(design.layouts[type])}
                    disabled={busy}
                    onChange={(event) => void onAssign(type, event.target.value)}
                  >
                    {BUILTIN_LAYOUTS.map((entry) => (
                      <option key={entry.id} value={refValue(entry)}>
                        {entry.name} (eingebaut)
                      </option>
                    ))}
                    {layouts
                      .filter((layout) => layout.art === artFor(type))
                      .map((layout) => (
                        <option key={layout.id} value={`eigen:${layout.id}`}>
                          {layout.name}
                        </option>
                      ))}
                  </select>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <NoticeBanner notice={notice} />
      <section aria-labelledby="eingebaute-layouts-heading">
        <h3 id="eingebaute-layouts-heading">Eingebaute Layouts</h3>
        <ul className="own-layouts">
          {(["beleg", "mahnung"] as const).map((art) => (
            <li key={art}>
              <div className="own-layout-name">
                <strong>{BUILTIN_LAYOUTS[0]!.name}</strong>
                <span className="small muted">{ART_LABEL[art]} · als Grundlage für ein eigenes Layout</span>
              </div>
              <div className="actions">
                <a
                  className="btn btn-sm"
                  href={`${DOWNLOAD}?datei=start&art=${art}`}
                  download
                  aria-label={`${BUILTIN_LAYOUTS[0]!.name} für ${ART_LABEL[art]} herunterladen`}
                >
                  Herunterladen
                </a>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <OwnLayouts layouts={layouts} />
      <LayoutUpload />
      <section aria-labelledby="layout-hilfe-heading">
        <h3 id="layout-hilfe-heading">Selbst schreiben</h3>
        <p className="small muted" style={{ margin: "0 0 8px" }}>
          Ein Layout ist eine Typst-Datei. Am einfachsten mit einem KI-Agenten: Gib ihm die Anleitung und ein eingebautes Layout als Grundlage, beschreibe das
          Aussehen und lade das Ergebnis hier hoch. Haben prüft es mit Beispieldaten, bevor es gilt.
        </p>
        <div className="actions" style={{ flexWrap: "wrap" }}>
          <a className="btn btn-sm" href={`${DOWNLOAD}?datei=anleitung`} download>
            Anleitung für KI-Agenten
          </a>
          <a className="btn btn-sm" href={`${DOWNLOAD}?datei=beispiele&art=beleg`} download>
            Beispieldaten Belege
          </a>
          <a className="btn btn-sm" href={`${DOWNLOAD}?datei=beispiele&art=mahnung`} download>
            Beispieldaten Mahnung
          </a>
          <a className="btn btn-sm" href={`${DOWNLOAD}?datei=feldvertrag`} download>
            Feldvertrag (JSON Schema)
          </a>
        </div>
      </section>
    </section>
  );
}

/** Die hochgeladenen Layouts; ab sieben scrollt die Liste */
function OwnLayouts({ layouts }: { layouts: LayoutRow[] }) {
  const router = useRouter();
  const rename = useServerFn(renameLayoutFn);
  const replace = useServerFn(replaceLayout);
  const remove = useServerFn(removeLayout);
  const reload = useServerFn(reloadLayoutPackages);
  const { busy, notice, run } = useAction();
  const [deleting, setDeleting] = useState<LayoutRow | null>(null);
  const [approving, setApproving] = useState<{ id: string; name: string; source: string; packages: string[] } | null>(null);

  const replaceWith = (layout: { id: string; name: string }, source: string, approve?: string[]) =>
    run(async () => {
      const result = await replace({ data: { id: layout.id, source, ...(approve ? { approve } : {}) } });
      if ("needsApproval" in result) {
        setApproving({ ...layout, source, packages: result.needsApproval });
        throw new Error("Das Layout braucht Pakete. Bestätige sie, damit Haben es prüfen kann.");
      }
      await router.invalidate();
    }, `„${layout.name}“ geprüft und ersetzt.`);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  if (layouts.length === 0) return <p className="small muted">Noch keine eigenen Layouts.</p>;
  return (
    <section aria-labelledby="eigene-layouts-heading">
      <h3 id="eigene-layouts-heading">Eigene Layouts</h3>
      <ul className="own-layouts" data-scrolls={layouts.length >= 7 || undefined}>
        {layouts.map((layout) => (
          <li key={layout.id}>
            {editing?.id === layout.id ? (
              <form
                className="own-layout-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await rename({ data: editing });
                    setEditing(null);
                    await router.invalidate();
                  }, "Umbenannt.");
                }}
              >
                <input
                  aria-label={`Neuer Name für ${layout.name}`}
                  value={editing.name}
                  maxLength={60}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
                <button type="submit" className="btn btn-sm" disabled={busy}>
                  Speichern
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>
                  Abbrechen
                </button>
              </form>
            ) : (
              <div className="own-layout-name">
                <strong>{layout.name}</strong>
                <span className="small muted">
                  {ART_LABEL[layout.art]} · geändert {formatDate(new Date(layout.updatedAt).toISOString().slice(0, 10))}
                </span>
              </div>
            )}
            {layout.packagesMissing && (
              <div className="banner banner-warn" role="status">
                Die freigegebenen Pakete fehlen, etwa nach einer Wiederherstellung. Bis du sie neu lädst, lässt sich mit diesem Layout nichts erzeugen.
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await reload({ data: layout.id });
                      await router.invalidate();
                    }, "Pakete geladen und geprüft.")
                  }
                >
                  Pakete neu laden
                </button>
              </div>
            )}
            <div className="actions">
              <a className="btn btn-sm" href={`${DOWNLOAD}?datei=layout&id=${layout.id}`} download>
                Herunterladen
              </a>
              <label className="btn btn-sm">
                Ersetzen
                <input
                  type="file"
                  accept=".typ,text/plain"
                  className="visually-hidden"
                  aria-label={`Neue Datei für ${layout.name}`}
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void readText(file).then((source) => replaceWith(layout, source));
                  }}
                />
              </label>
              <button type="button" className="btn btn-sm" onClick={() => setEditing({ id: layout.id, name: layout.name })}>
                Umbenennen
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => setDeleting(layout)}>
                Löschen
              </button>
            </div>
          </li>
        ))}
      </ul>
      {busy && (
        <p className="small muted" role="status">
          Haben setzt das Layout mit Beispieldaten …
        </p>
      )}
      <NoticeBanner notice={notice} />
      <ConfirmDialog
        open={deleting !== null}
        title={`Layout „${deleting?.name ?? ""}“ löschen?`}
        confirmLabel="Layout löschen"
        danger
        onConfirm={() =>
          void run(async () => {
            await remove({ data: deleting!.id });
            await router.invalidate();
          }, "Gelöscht. Wo es zugeordnet war, gilt wieder das eingebaute Layout.")
        }
        onClose={() => setDeleting(null)}
      >
        <p>Wo es zugeordnet ist, gilt danach wieder das eingebaute Layout. Festgeschriebene Belege behalten ihr PDF.</p>
      </ConfirmDialog>
      <PackageDialog
        packages={approving?.packages ?? null}
        onConfirm={() => approving && void replaceWith(approving, approving.source, approving.packages)}
        onClose={() => setApproving(null)}
      />
    </section>
  );
}

/** Neues Layout hochladen: Haben prüft es, bevor es gespeichert wird */
function LayoutUpload() {
  const router = useRouter();
  const upload = useServerFn(uploadLayout);
  const { busy, notice, run } = useAction();
  const [name, setName] = useState("");
  const [art, setArt] = useState<"beleg" | "mahnung">("beleg");
  const [file, setFile] = useState<File | null>(null);
  const [approving, setApproving] = useState<{ source: string; packages: string[] } | null>(null);

  const send = (source: string, approve?: string[]) =>
    run(async () => {
      const result = await upload({ data: { name, art, source, ...(approve ? { approve } : {}) } });
      if ("needsApproval" in result) {
        setApproving({ source, packages: result.needsApproval });
        throw new Error("Das Layout braucht Pakete. Bestätige sie, damit Haben es prüfen kann.");
      }
      setName("");
      setFile(null);
      await router.invalidate();
    }, "Geprüft und gespeichert. Ordne es oben einer Belegart zu, damit es gilt.");

  return (
    <form
      aria-labelledby="layout-upload-heading"
      onSubmit={(event) => {
        event.preventDefault();
        if (file) void readText(file).then((source) => send(source));
      }}
    >
      <h3 id="layout-upload-heading">Layout hochladen</h3>
      <div className="form-grid">
        <Field label="Name">{(control) => <input {...control} value={name} maxLength={60} required onChange={(event) => setName(event.target.value)} />}</Field>
        <Field label="Für">
          {(control) => (
            <select {...control} value={art} onChange={(event) => setArt(event.target.value as "beleg" | "mahnung")}>
              <option value="beleg">Rechnung, Angebot, Auftragsbestätigung, Lieferschein</option>
              <option value="mahnung">Mahnung</option>
            </select>
          )}
        </Field>
        <Field label="Typst-Datei" hint=".typ, bis 256 KB">
          {(control) => <input {...control} type="file" accept=".typ,text/plain" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} />}
        </Field>
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !file || !name.trim()}>
          Prüfen und speichern
        </button>
      </div>
      {busy && (
        <p className="small muted" role="status">
          Haben setzt das Layout mit Beispieldaten …
        </p>
      )}
      <NoticeBanner notice={notice} />
      <PackageDialog
        packages={approving?.packages ?? null}
        onConfirm={() => approving && void send(approving.source, approving.packages)}
        onClose={() => setApproving(null)}
      />
    </form>
  );
}
