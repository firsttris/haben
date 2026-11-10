import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { deleteCustomPageFn, saveCustomPage, type getCustomPages } from "../server/functions/eigene-seiten.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";

type Page = Awaited<ReturnType<typeof getCustomPages>>[number];

export const EIGENE_SEITEN_DOCS = "https://haben.app/eigene-seiten.html";

/** Einstellungen → Eigene Seiten (#199): Menüeinträge für Seiten außerhalb von Haben anlegen, ändern und löschen */
export function EigeneSeitenCard({ pages }: { pages: Page[] }) {
  const router = useRouter();
  const save = useServerFn(saveCustomPage);
  const remove = useServerFn(deleteCustomPageFn);
  const { busy, notice, run } = useAction();
  // Die Seite, die gerade im Formular steht; null = neue Seite
  const [editing, setEditing] = useState<Page | null>(null);
  const [removing, setRemoving] = useState<Page | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const page = { name: String(values.get("name") ?? ""), url: String(values.get("url") ?? "") };
    void run(
      async () => {
        await save({ data: { id: editing?.id ?? null, page } });
        setEditing(null);
        form.reset();
        // Lädt auch das Menü neu (_app lädt die eigenen Seiten in beforeLoad)
        await router.invalidate();
      },
      editing ? "Seite gespeichert." : "Seite angelegt. Sie steht jetzt im Menü.",
    );
  }

  function deleteNow(page: Page) {
    void run(async () => {
      await remove({ data: { id: page.id } });
      if (editing?.id === page.id) setEditing(null);
      await router.invalidate();
    }, "Seite entfernt.");
  }

  return (
    <section className="card" aria-labelledby="eigene-seiten-heading">
      <h2 id="eigene-seiten-heading">Eigene Seiten</h2>
      <ConfirmDialog
        open={removing !== null}
        title={`„${removing?.name}“ aus dem Menü entfernen?`}
        confirmLabel="Entfernen"
        danger
        onConfirm={() => removing && deleteNow(removing)}
        onClose={() => setRemoving(null)}
      >
        <p>Die Seite selbst bleibt, wo sie ist.</p>
      </ConfirmDialog>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        Eine eigene Seite steht im Menü und öffnet eine Seite außerhalb von Haben im Rahmen, etwa eine Bestellübersicht oder ein Formular aus n8n. So arbeitest
        du in einer Oberfläche, und Haben bleibt die Buchhaltung.
      </p>
      {/* Ein Element: .banner ist ein Flex-Container und setzte Text und Links sonst in Spalten */}
      <div className="banner banner-info" style={{ maxWidth: 760 }}>
        <span>
          Haben gibt der Seite keine Anmeldung mit. Braucht sie Daten aus Haben, nutzt sie die REST-API mit einem eigenen Token (
          <Link to="/einstellungen" search={{ bereich: "ki" }}>
            KI-Assistenten und API
          </Link>
          ). Die Seite muss unter einer anderen Adresse laufen als Haben und das Einbetten erlauben.{" "}
          <a href={EIGENE_SEITEN_DOCS} target="_blank" rel="noreferrer">
            Anleitung
          </a>
        </span>
      </div>

      {pages.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          Noch keine eigene Seite.
        </p>
      ) : (
        <div>
          {pages.map((page) => (
            <div key={page.id} className="history-row">
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <Link to="/seiten/$id" params={{ id: page.id }} style={{ fontWeight: 500 }}>
                  {page.name}
                </Link>
                <span className="small muted mono" style={{ overflowWrap: "anywhere" }}>
                  {page.url}
                </span>
              </div>
              <div className="actions">
                <button type="button" className="btn" disabled={busy} onClick={() => setEditing(page)} aria-label={`${page.name} bearbeiten`}>
                  Bearbeiten
                </button>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setRemoving(page)} aria-label={`${page.name} entfernen`}>
                  Entfernen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* key: beim Wechsel der bearbeiteten Seite stehen ihre Werte im Formular */}
      <form key={editing?.id ?? "neu"} className="form-grid" onSubmit={onSubmit} aria-label={editing ? `${editing.name} bearbeiten` : "Neue eigene Seite"}>
        <Field label="Name im Menü">
          {(control) => <input {...control} name="name" required maxLength={40} defaultValue={editing?.name} placeholder="Bestellungen" />}
        </Field>
        <Field label="Adresse">
          {(control) => (
            <input
              {...control}
              name="url"
              type="url"
              required
              maxLength={2000}
              defaultValue={editing?.url}
              placeholder="https://n8n.example.de/webhook/bestellungen"
            />
          )}
        </Field>
        <div className="actions" style={{ gridColumn: "1 / -1" }}>
          {editing && (
            <button type="button" className="btn" disabled={busy} onClick={() => setEditing(null)}>
              Abbrechen
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {editing ? "Speichern" : "Seite hinzufügen"}
          </button>
        </div>
      </form>
      <NoticeBanner notice={notice} />
    </section>
  );
}
