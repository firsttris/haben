import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { checkCustomPageEmbeddingFn, deleteCustomPageFn, saveCustomPage, type getCustomPages } from "../server/functions/eigene-seiten.ts";
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
    const page = { name: String(values.get("name") ?? ""), url: String(values.get("url") ?? ""), openInNewTab: values.get("open") === "tab" };
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
        Eine eigene Seite steht im Menü und zeigt eine Seite außerhalb von Haben, etwa eine Bestellübersicht oder ein Formular aus n8n. So arbeitest du in einer
        Oberfläche, und Haben bleibt die Buchhaltung. Seiten, die das Einbetten verbieten, öffnest du in einem neuen Tab.
      </p>
      {/* Ein Element: .banner ist ein Flex-Container und setzte Text und Links sonst in Spalten */}
      <div className="banner banner-info" style={{ maxWidth: 760 }}>
        <span>
          Haben gibt der Seite keine Anmeldung mit. Braucht sie Daten aus Haben, nutzt sie die REST-API mit einem eigenen Token (
          <Link to="/einstellungen" search={{ bereich: "ki" }}>
            KI-Assistenten und API
          </Link>
          ). Die Seite muss unter einer anderen Adresse laufen als Haben und, damit sie in Haben erscheint, das Einbetten erlauben.{" "}
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
                {page.openInNewTab && <span className="small muted">Öffnet in neuem Tab</span>}
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
        <PageTargetFields editing={editing} />
        <div className="actions" style={{ gridColumn: "1 / -1" }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {editing ? "Speichern" : "Seite hinzufügen"}
          </button>
          {editing && (
            <button type="button" className="btn" disabled={busy} onClick={() => setEditing(null)}>
              Abbrechen
            </button>
          )}
        </div>
      </form>
      <NoticeBanner notice={notice} />
    </section>
  );
}

type Embedding = Awaited<ReturnType<typeof checkCustomPageEmbeddingFn>>;

/**
 * Adresse und wie sich die Seite öffnet (#636). Ist „In Haben“ gewählt, prüft Haben nach der Eingabe der Adresse, ob
 * die Seite das Einbetten verbietet (X-Frame-Options, frame-ancestors), und rät dann zum neuen Tab.
 */
function PageTargetFields({ editing }: { editing: Page | null }) {
  const check = useServerFn(checkCustomPageEmbeddingFn);
  const [url, setUrl] = useState(editing?.url ?? "");
  const [open, setOpen] = useState<"haben" | "tab">(editing?.openInNewTab ? "tab" : "haben");
  // Die zuletzt geprüfte Adresse mit Ergebnis; null = noch nicht geprüft oder Prüfung läuft
  const [checked, setChecked] = useState<{ url: string; result: Embedding | null } | null>(null);

  const trimmed = url.trim();
  useEffect(() => {
    if (open !== "haben" || !URL.canParse(trimmed)) return;
    let current = true;
    // Erst prüfen, wenn das Tippen ruht; jede Prüfung ruft die Seite einmal auf
    const timer = setTimeout(() => {
      setChecked({ url: trimmed, result: null });
      check({ data: { url: trimmed } })
        .then((result) => current && setChecked({ url: trimmed, result }))
        // Ungültige Adresse: die Meldung kommt beim Speichern
        .catch(() => current && setChecked(null));
    }, 600);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, trimmed, check]);

  const result = open === "haben" && checked?.url === trimmed ? checked.result : undefined;
  return (
    <>
      <Field label="Adresse">
        {(control) => (
          <input
            {...control}
            name="url"
            type="url"
            required
            maxLength={2000}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://n8n.example.de/webhook/bestellungen"
          />
        )}
      </Field>
      <Field label="Öffnen" hint={<EmbeddingHint open={open} result={result} />}>
        {(control) => (
          <select {...control} name="open" value={open} onChange={(event) => setOpen(event.target.value === "tab" ? "tab" : "haben")}>
            <option value="haben">In Haben, neben dem Menü</option>
            <option value="tab">In neuem Tab</option>
          </select>
        )}
      </Field>
      {result?.status === "blocked" && (
        <div className="banner banner-warn" role="status" style={{ gridColumn: "1 / -1" }}>
          <span>
            Diese Seite verbietet das Einbetten ({result.header}). In Haben bliebe sie leer. Wähle „In neuem Tab“ oder erlaube Haben das Einbetten in der Seite.{" "}
            <a href={`${EIGENE_SEITEN_DOCS}#was-die-seite-können-muss`} target="_blank" rel="noreferrer">
              Wie das geht
            </a>
          </span>
        </div>
      )}
    </>
  );
}

function EmbeddingHint({ open, result }: { open: "haben" | "tab"; result: Embedding | null | undefined }) {
  if (open === "tab") return "Der Menüeintrag öffnet die Seite in einem neuen Tab, ohne Rahmen. Das geht mit jeder Seite.";
  if (result === null) return "Prüfe, ob die Seite das Einbetten erlaubt …";
  if (result?.status === "allowed") return "Die Seite erlaubt das Einbetten.";
  if (result?.status === "unknown") return "Haben erreicht die Seite nicht. Ob sie sich einbetten lässt, siehst du nach dem Speichern im Menü.";
  if (result?.status === "blocked") return "Die Seite lässt sich nicht einbetten.";
  return "Die Seite erscheint im Rahmen neben dem Menü. Manche Seiten verbieten das; Haben prüft es nach der Eingabe der Adresse.";
}
