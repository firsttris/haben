import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";
import { useAction } from "../lib/use-action.ts";
import { saveContactPerson, setContactPersonActiveFn } from "../server/functions/contact-persons.ts";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { Tag } from "./Status.tsx";

/**
 * Ansprechpartner eines Kontakts (#424): Name, E-Mail, Telefon und Funktion. Im Entwurf von Rechnung und Angebot wählbar;
 * im PDF steht „z. Hd. <Name>“, in der E-Rechnung der Name als BT-56. Eine Person wird deaktiviert statt gelöscht: Sie
 * kann an Entwürfen und an festgeschriebenen Belegen hängen.
 */

export type ContactPersonRow = {
  id: string;
  name: string;
  email: string;
  telefon: string;
  funktion: string;
  deactivatedAt: string | null;
};

type Props = { contactId: string; persons: ContactPersonRow[] };

export function ContactPersonsCard({ contactId, persons }: Props) {
  const router = useRouter();
  const save = useServerFn(saveContactPerson);
  const setActive = useServerFn(setContactPersonActiveFn);
  const { busy, notice, run } = useAction();
  /** Neu anlegen (leer) oder eine Person ändern; null = Formular zu */
  const [editing, setEditing] = useState<ContactPersonRow | "neu" | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    const target = editing;
    void run(
      async () => {
        await save({
          data: {
            contactId,
            ...(target && target !== "neu" ? { id: target.id } : {}),
            person: { name: text("name"), email: text("email"), telefon: text("telefon"), funktion: text("funktion") },
          },
        });
        await router.invalidate();
        setEditing(null);
      },
      target === "neu" ? "Ansprechpartner angelegt." : "Ansprechpartner gespeichert.",
    );
  }

  function toggle(person: ContactPersonRow) {
    void run(async () => {
      await setActive({ data: { id: person.id, active: person.deactivatedAt !== null } });
      await router.invalidate();
    });
  }

  return (
    <section className="card" aria-labelledby="ansprechpartner-heading">
      <h2 id="ansprechpartner-heading">Ansprechpartner</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Im Angebot und in der Rechnung wählbar; das PDF nennt sie als „z. Hd.“ unter dem Firmennamen, die E-Rechnung als Ansprechpartner des Käufers. Beleg und
        Mahnung behalten den Stand vom Festschreiben, auch wenn sich die Person später ändert. Wer nicht mehr dabei ist, wird deaktiviert.
      </p>
      <NoticeBanner notice={notice} />
      {persons.map((person) => (
        <div key={person.id} className="history-row stack" style={{ alignItems: "stretch", gap: 4 }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <strong>{person.name}</strong>
            {person.deactivatedAt && <Tag>deaktiviert</Tag>}
          </div>
          {(person.funktion || person.email || person.telefon) && (
            <span className="small muted">{[person.funktion, person.email, person.telefon].filter(Boolean).join(" · ")}</span>
          )}
          <div className="actions" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setEditing(person)} aria-label={`${person.name} ändern`}>
              Ändern
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => toggle(person)}
              aria-label={`${person.name} ${person.deactivatedAt ? "aktivieren" : "deaktivieren"}`}
            >
              {person.deactivatedAt ? "Aktivieren" : "Deaktivieren"}
            </button>
          </div>
        </div>
      ))}
      {persons.length === 0 && editing === null && (
        <p className="small muted" style={{ margin: 0 }}>
          Noch kein Ansprechpartner.
        </p>
      )}
      {editing === null && (
        <div className="actions">
          <button type="button" className="btn" onClick={() => setEditing("neu")}>
            Ansprechpartner hinzufügen
          </button>
        </div>
      )}
      {editing !== null && (
        <form
          key={editing === "neu" ? "neu" : editing.id}
          className="stack"
          onSubmit={onSubmit}
          aria-label={editing === "neu" ? "Neuer Ansprechpartner" : "Ansprechpartner ändern"}
        >
          <Field label="Name">
            {(control) => <input {...control} name="name" required maxLength={100} defaultValue={editing === "neu" ? "" : editing.name} autoFocus />}
          </Field>
          <div className="form-row cols-2">
            <Field label="E-Mail">
              {(control) => <input {...control} name="email" type="email" maxLength={200} defaultValue={editing === "neu" ? "" : editing.email} />}
            </Field>
            <Field label="Telefon">
              {(control) => <input {...control} name="telefon" type="tel" maxLength={50} defaultValue={editing === "neu" ? "" : editing.telefon} />}
            </Field>
          </div>
          <Field label="Funktion" hint="Funktion oder Abteilung, etwa „Einkauf“. Steht nur hier, nicht im PDF und nicht in der E-Rechnung.">
            {(control) => <input {...control} name="funktion" maxLength={100} defaultValue={editing === "neu" ? "" : editing.funktion} />}
          </Field>
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={() => setEditing(null)}>
              Abbrechen
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Speichern
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
