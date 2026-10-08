import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { FormEvent } from "react";
import { saveContact } from "../server/functions/contacts.ts";
import type { Contact, ContactInput } from "../server/contacts.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { FORMAT_LABEL, FORMATS } from "../lib/invoice.ts";
import { useAction } from "../lib/use-action.ts";

const EMPTY: ContactInput = {
  kundennummer: "",
  name: "",
  strasse: "",
  plz: "",
  ort: "",
  land: "DE",
  email: "",
  ustId: "",
  iban: "",
  leitwegId: "",
  defaultFormat: null,
  language: "de",
};

export function ContactForm({ contact }: { contact: Contact | null }) {
  const router = useRouter();
  const navigate = useNavigate();
  const save = useServerFn(saveContact);
  const { busy, notice, setNotice, run } = useAction();
  const initial: ContactInput = contact
    ? { ...EMPTY, ...contact, kundennummer: contact.kundennummer ?? "", defaultFormat: contact.defaultFormat }
    : EMPTY;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: keyof ContactInput) => String(form.get(name) ?? "").trim();
    const format = text("defaultFormat");
    void run(async () => {
      const result = await save({
        data: {
          id: contact?.id ?? null,
          contact: {
            kundennummer: text("kundennummer"),
            name: text("name"),
            strasse: text("strasse"),
            plz: text("plz"),
            ort: text("ort"),
            land: text("land").toUpperCase() || "DE",
            email: text("email"),
            ustId: text("ustId").replace(/\s/g, "").toUpperCase(),
            iban: text("iban").replace(/\s/g, "").toUpperCase(),
            leitwegId: text("leitwegId"),
            defaultFormat: format ? (format as ContactInput["defaultFormat"]) : null,
            language: text("language") === "en" ? "en" : "de",
          },
        },
      });
      if (contact) {
        await router.invalidate();
        setNotice({ tone: "ok", text: "Gespeichert. Die vorige Fassung bleibt als Version erhalten." });
      } else {
        await navigate({ to: "/kontakte/$id", params: { id: result.id } });
      }
    });
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-label="Kontakt">
      <div className="form-grid">
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          Name oder Firma
          <input name="name" defaultValue={initial.name} required autoComplete="organization" />
        </label>
        <label className="field">
          Kundennummer
          <input name="kundennummer" defaultValue={initial.kundennummer} />
        </label>
        <label className="field">
          E-Mail
          <input name="email" type="email" defaultValue={initial.email} />
        </label>
        <label className="field">
          Straße und Hausnummer
          <input name="strasse" defaultValue={initial.strasse} />
        </label>
        <label className="field">
          PLZ
          <input name="plz" defaultValue={initial.plz} />
        </label>
        <label className="field">
          Ort
          <input name="ort" defaultValue={initial.ort} />
        </label>
        <label className="field">
          Land (ISO-Code)
          <input name="land" defaultValue={initial.land} maxLength={2} />
        </label>
        <label className="field">
          USt-IdNr.
          <input name="ustId" defaultValue={initial.ustId} placeholder="DE123456789" />
        </label>
        <label className="field">
          IBAN
          <input name="iban" defaultValue={initial.iban} />
        </label>
        <label className="field">
          Leitweg-ID (öffentliche Auftraggeber)
          <input name="leitwegId" defaultValue={initial.leitwegId} />
        </label>
        <label className="field">
          Standardformat für Rechnungen
          <select name="defaultFormat" defaultValue={initial.defaultFormat ?? ""}>
            <option value="">wie in den Einstellungen</option>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Sprache von Rechnungen und Angeboten
          <select name="language" defaultValue={initial.language ?? "de"}>
            <option value="de">Deutsch</option>
            <option value="en">Englisch</option>
          </select>
        </label>
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {contact ? "Speichern" : "Kontakt anlegen"}
        </button>
        <Link to="/kontakte" className="btn">
          Abbrechen
        </Link>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}
