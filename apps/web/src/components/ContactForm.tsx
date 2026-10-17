import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { FormEvent } from "react";
import { saveContact } from "../server/functions/contacts.ts";
import type { Contact, ContactInput } from "../server/modules/stammdaten/index.ts";
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
    <form className="card form-card contact-form" onSubmit={onSubmit} aria-label="Kontakt">
      <section className="form-section" aria-labelledby="contact-basics">
        <h2 id="contact-basics">Allgemein</h2>
        <label className="field">
          Name oder Firma
          <input name="name" defaultValue={initial.name} required autoComplete="organization" placeholder="z. B. Muster GmbH" />
        </label>
        <div className="form-row cols-2">
          <label className="field">
            E-Mail
            <input name="email" type="email" defaultValue={initial.email} autoComplete="email" placeholder="rechnung@kunde.de" />
          </label>
          <label className="field">
            Kundennummer
            <input name="kundennummer" defaultValue={initial.kundennummer} placeholder="optional" />
          </label>
        </div>
      </section>

      <section className="form-section" aria-labelledby="contact-address">
        <h2 id="contact-address">Anschrift</h2>
        <label className="field">
          Straße und Hausnummer
          <input name="strasse" defaultValue={initial.strasse} autoComplete="street-address" />
        </label>
        <div className="form-row cols-address">
          <label className="field">
            PLZ
            <input name="plz" defaultValue={initial.plz} autoComplete="postal-code" inputMode="numeric" />
          </label>
          <label className="field">
            Ort
            <input name="ort" defaultValue={initial.ort} autoComplete="address-level2" />
          </label>
          <label className="field">
            Land (ISO-Code)
            <input name="land" defaultValue={initial.land} maxLength={2} autoComplete="country" className="uppercase" />
          </label>
        </div>
      </section>

      <section className="form-section" aria-labelledby="contact-tax">
        <h2 id="contact-tax">Steuer und Zahlung</h2>
        <div className="form-row cols-2">
          <label className="field">
            USt-IdNr.
            <input name="ustId" defaultValue={initial.ustId} placeholder="DE123456789" className="mono" />
          </label>
          <label className="field">
            IBAN
            <input name="iban" defaultValue={initial.iban} placeholder="DE00 0000 0000 0000 0000 00" className="mono" />
          </label>
        </div>
        <div className="field-group">
          <label className="field">
            Leitweg-ID (öffentliche Auftraggeber)
            <input name="leitwegId" defaultValue={initial.leitwegId} aria-describedby="leitweg-hint" className="mono" />
          </label>
          <p id="leitweg-hint" className="field-hint">
            Nur bei Rechnungen an Behörden nötig; steht in deren Auftrag.
          </p>
        </div>
      </section>

      <section className="form-section" aria-labelledby="contact-invoices">
        <h2 id="contact-invoices">Rechnungen</h2>
        <div className="form-row cols-2">
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
      </section>

      <NoticeBanner notice={notice} />
      <div className="actions form-footer">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {contact ? "Speichern" : "Kontakt anlegen"}
        </button>
        <Link to="/kontakte" className="btn">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
