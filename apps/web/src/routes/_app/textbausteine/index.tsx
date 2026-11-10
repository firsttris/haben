import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../../../lib/format.ts";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { FormattedText } from "../../../components/FormattedText.tsx";
import { FormattedTextarea } from "../../../components/FormattedTextarea.tsx";
import type { Notice } from "../../../lib/use-action.ts";
import { archiveTextBlock, getTextBlocks, saveTextBlock } from "../../../server/functions/text-blocks.ts";
import { Field } from "../../../components/Field.tsx";

export const Route = createFileRoute("/_app/textbausteine/")({
  loader: () => getTextBlocks(),
  head: () => ({ meta: [{ title: "Textbausteine · Haben" }] }),
  component: TextBlocksPage,
});

type Data = Awaited<ReturnType<typeof getTextBlocks>>;
type Block = Data["blocks"][number];
type ContactOption = Data["contacts"][number];

const KIND_LABEL = { kopf: "Kopftext", fuss: "Fußtext" } as const;

function TextBlockForm({ block, contacts, onDone }: { block: Block | null; contacts: ContactOption[]; onDone: (notice: Notice) => void }) {
  const router = useRouter();
  const save = useServerFn(saveTextBlock);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await save({
        data: {
          id: block?.id ?? null,
          block: {
            name: value("name"),
            kind: value("kind") === "fuss" ? "fuss" : "kopf",
            text: value("text"),
            contactId: value("contactId") || null,
          },
        },
      });
      await router.invalidate();
      onDone({ tone: "ok", text: block ? "Textbaustein gespeichert." : "Textbaustein angelegt." });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const title = block ? "Textbaustein bearbeiten" : "Neuer Textbaustein";
  return (
    <form className="card" style={{ maxWidth: 720 }} onSubmit={onSubmit} aria-label={title}>
      <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
      <div className="form-grid">
        <Field label="Bezeichnung" hint="Nur für die Auswahl, erscheint nicht auf dem Beleg.">
          {(control) => (
            <input
              {...control}
              name="name"
              defaultValue={block?.name ?? ""}
              maxLength={200}
              required
              autoFocus
              placeholder="z. B. Rahmenvertrag Projekt Phoenix"
            />
          )}
        </Field>
        <Field label="Art">
          {(control) => (
            <select {...control} name="kind" defaultValue={block?.kind ?? "kopf"}>
              <option value="kopf">Kopftext (Einleitung über den Positionen)</option>
              <option value="fuss">Fußtext (Hinweis unter den Summen)</option>
            </select>
          )}
        </Field>
        <Field
          label="Text"
          hint={
            <>
              In wiederkehrenden Rechnungen gelten auch hier Platzhalter wie {"{monat}"} oder {"{zeitraum}"}.
            </>
          }
          style={{ gridColumn: "1 / -1" }}
        >
          {(control) => <FormattedTextarea {...control} name="text" rows={5} defaultValue={block?.text ?? ""} maxLength={2000} required />}
        </Field>
        <Field label="Kunde (optional)" hint="Bei Belegen an diesen Kunden steht der Baustein in der Auswahl oben." style={{ gridColumn: "1 / -1" }}>
          {(control) => (
            <select {...control} name="contactId" defaultValue={block?.contactId ?? ""}>
              <option value="">Für alle Kunden</option>
              {contacts
                .filter((c) => c.isCustomer || c.id === block?.contactId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.ort ? ` · ${c.ort}` : ""}
                  </option>
                ))}
            </select>
          )}
        </Field>
      </div>
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={() => onDone(null)}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {block ? "Speichern" : "Anlegen"}
        </button>
      </div>
    </form>
  );
}

function TextBlocksPage() {
  const { blocks, contacts } = Route.useLoaderData();
  const router = useRouter();
  const archive = useServerFn(archiveTextBlock);
  const [editing, setEditing] = useState<Block | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [showArchived, setShowArchived] = useState(false);
  const active = blocks.filter((b) => !b.archivedAt);
  const archived = blocks.filter((b) => b.archivedAt);
  const shown = showArchived ? archived : active;
  const contactName = (id: string | null) => (id ? (contacts.find((c) => c.id === id)?.name ?? "Archivierter Kontakt") : "Alle Kunden");

  async function toggleArchive(block: Block) {
    try {
      await archive({ data: { id: block.id, archived: !block.archivedAt } });
      await router.invalidate();
      setNotice({ tone: "ok", text: block.archivedAt ? "Textbaustein wieder aktiv." : "Textbaustein archiviert." });
    } catch (e) {
      setNotice({ tone: "danger", text: errorMessage(e) });
    }
  }

  const formOpen = creating || editing !== null;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Verkauf</div>
          <h1>Textbausteine</h1>
        </div>
        {!formOpen && (
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditing(null);
                setCreating(true);
                setNotice(null);
              }}
            >
              Neuer Textbaustein
            </button>
          </div>
        )}
      </div>
      <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
        Kopf- und Fußtexte legst du einmal an und fügst sie in Rechnung, Angebot oder wiederkehrender Rechnung mit „Textbaustein einfügen“ ein. Eingefügt wird
        eine Kopie: Sie lässt sich im Beleg noch anpassen, und spätere Änderungen am Baustein ändern keine geschriebene Rechnung.
      </p>
      <div className="stack" style={{ gap: 16 }}>
        {formOpen && (
          <TextBlockForm
            key={editing?.id ?? "neu"}
            block={editing}
            contacts={contacts}
            onDone={(n) => {
              setEditing(null);
              setCreating(false);
              setNotice(n);
            }}
          />
        )}
        <NoticeBanner notice={notice} />
        <section className="card" aria-label="Textbausteine">
          <div className="chip-row" role="group" aria-label="Filter">
            <button type="button" className={`chip${showArchived ? "" : " active"}`} aria-pressed={!showArchived} onClick={() => setShowArchived(false)}>
              Aktiv ({active.length})
            </button>
            <button type="button" className={`chip${showArchived ? " active" : ""}`} aria-pressed={showArchived} onClick={() => setShowArchived(true)}>
              Archiviert ({archived.length})
            </button>
          </div>
          {shown.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {showArchived ? "Keine archivierten Textbausteine." : "Noch keine Textbausteine. Lege den ersten mit „Neuer Textbaustein“ an."}
            </p>
          ) : (
            <div className="table">
              {shown.map((b) => (
                <div key={b.id} className="table-row" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{b.name}</div>
                    <div className="small muted">
                      {KIND_LABEL[b.kind]} · {contactName(b.contactId)}
                    </div>
                    <div className="small" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 4 }}>
                      <FormattedText text={b.text} />
                    </div>
                  </div>
                  <div className="actions" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    {!b.archivedAt && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setCreating(false);
                          setEditing(b);
                        }}
                        aria-label={`${b.name} bearbeiten`}
                      >
                        Bearbeiten
                      </button>
                    )}
                    <button type="button" className="btn btn-sm" onClick={() => void toggleArchive(b)}>
                      {b.archivedAt ? "Wiederherstellen" : "Archivieren"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
