import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { parsePersonenkonto } from "@haben/core";
import { useRef, useState, type FormEvent } from "react";
import { saveContact } from "../server/functions/contacts.ts";
import type { Contact, ContactInput } from "../server/modules/stammdaten/index.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { parseSkontoRows, SkontoFields, toSkontoRows } from "./SkontoFields.tsx";
import { FORMAT_LABEL, FORMATS } from "../lib/invoice.ts";
import { useAction } from "../lib/use-action.ts";

/** USt-IdNr. zum Vergleichen: ohne Leerzeichen, groß */
const compactUstId = (value: string) => value.replace(/\s/g, "").toUpperCase();

const EMPTY: ContactInput = {
  kundennummer: "",
  name: "",
  strasse: "",
  plz: "",
  ort: "",
  land: "DE",
  email: "",
  telefon: "",
  ustId: "",
  iban: "",
  leitwegId: "",
  defaultFormat: null,
  language: "de",
  isCustomer: true,
  isSupplier: false,
  lieferantennummer: "",
};

/** Ein neu angelegter Kontakt, wie ihn ein Formular für seine Auswahl braucht */
export type SavedContact = ContactInput & { id: string };

/** Kontakt, den Haben statt einer Dublette anbietet (gleiche USt-IdNr.) */
export interface ExistingContact {
  id: string;
  name: string;
  ustId: string;
}

/**
 * nextNumber: Kundennummer, die Haben beim Anlegen ohne eigene Nummer vergibt; null = keine automatische Vergabe.
 * Im Dialog eines anderen Formulars (Beleg, Rechnungsentwurf, #330): prefill füllt vor, onSaved bekommt den neuen
 * Kontakt statt der Weiterleitung, onCancel ersetzt den Link zurück; existing bietet bei gleicher USt-IdNr. den
 * vorhandenen Kontakt an (onPickExisting), ohne ihn still zusammenzuführen.
 */
const SAVED_NOTICE = { tone: "ok", text: "Gespeichert. Die vorige Fassung bleibt als Version erhalten." } as const;

export function ContactForm({
  contact,
  nextNumber = null,
  prefill,
  onSaved,
  onCancel,
  existing = [],
  onPickExisting,
  ibanSuggestion = null,
  saved = false,
  onUpdated,
}: {
  contact: Contact | null;
  nextNumber?: string | null;
  prefill?: Partial<ContactInput>;
  onSaved?: (saved: SavedContact) => void;
  onCancel?: () => void;
  existing?: ExistingContact[];
  onPickExisting?: (id: string) => void;
  /** IBAN vom Beleg (#329): nur ein Vorschlag, ins Feld erst auf ausdrücklichen Klick */
  ibanSuggestion?: IbanSuggestion | null;
  /**
   * Gerade gespeichert: Die Seite baut das Formular mit der neuen Version neu auf (key), sein Zustand ginge dabei verloren.
   * Deshalb merkt sich die Seite das Speichern (onUpdated) und gibt es hier zurück, damit die Meldung stehen bleibt.
   */
  saved?: boolean;
  onUpdated?: () => void;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const save = useServerFn(saveContact);
  const { busy, notice, run } = useAction();
  const ibanInput = useRef<HTMLInputElement>(null);
  const takeIban = (iban: string) => {
    if (!ibanInput.current) return;
    ibanInput.current.value = iban;
    ibanInput.current.focus();
  };
  const [ustId, setUstId] = useState(contact?.ustId ?? prefill?.ustId ?? "");
  const sameUstId = compactUstId(ustId) ? existing.find((c) => c.id !== contact?.id && compactUstId(c.ustId) === compactUstId(ustId)) : undefined;
  // Skonto: null = Vorgabe aus den Einstellungen; eigene Stufen, leer = ohne Skonto
  const [ownSkonto, setOwnSkonto] = useState(contact?.skonto != null);
  const [skontoRows, setSkontoRows] = useState(() => toSkontoRows(contact?.skonto ?? []));
  const initial: ContactInput = contact
    ? {
        ...EMPTY,
        ...contact,
        kundennummer: contact.kundennummer ?? "",
        lieferantennummer: contact.lieferantennummer ?? "",
        defaultFormat: contact.defaultFormat,
      }
    : { ...EMPTY, ...prefill };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: keyof ContactInput) => String(form.get(name) ?? "").trim();
    const format = text("defaultFormat");
    const isCustomer = form.get("isCustomer") === "on";
    const isSupplier = form.get("isSupplier") === "on";
    const skonto = parseSkontoRows(skontoRows);
    const debitor = parsePersonenkonto("debitor", text("debitorNr"));
    const kreditor = parsePersonenkonto("kreditor", text("kreditorNr"));
    void run(async () => {
      if (!isCustomer && !isSupplier) throw new Error("Ein Kontakt ist Kunde oder Lieferant oder beides.");
      if (!debitor.ok) throw new Error(debitor.error);
      if (!kreditor.ok) throw new Error(kreditor.error);
      if (ownSkonto && !skonto.valid) throw new Error("Skonto: je Stufe einen Satz (z. B. 2) und eine Frist in Tagen angeben.");
      const input = {
        kundennummer: text("kundennummer"),
        name: text("name"),
        strasse: text("strasse"),
        plz: text("plz"),
        ort: text("ort"),
        land: text("land").toUpperCase() || "DE",
        email: text("email"),
        telefon: text("telefon"),
        ustId: text("ustId").replace(/\s/g, "").toUpperCase(),
        iban: text("iban").replace(/\s/g, "").toUpperCase(),
        leitwegId: text("leitwegId"),
        defaultFormat: format ? (format as ContactInput["defaultFormat"]) : null,
        language: text("language") === "en" ? "en" : "de",
        skonto: ownSkonto ? skonto.stufen : null,
        isCustomer,
        isSupplier,
        lieferantennummer: text("lieferantennummer"),
        debitorNr: debitor.value,
        kreditorNr: kreditor.value,
      } satisfies ContactInput;
      const result = await save({ data: { id: contact?.id ?? null, contact: input } });
      if (onSaved) {
        onSaved({ ...input, id: result.id });
      } else if (contact) {
        onUpdated?.();
        await router.invalidate();
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
        <fieldset className="field-group" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small">Rolle</legend>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <label className="checkbox">
              <input type="checkbox" name="isCustomer" defaultChecked={initial.isCustomer ?? true} />
              Kunde
            </label>
            <label className="checkbox">
              <input type="checkbox" name="isSupplier" defaultChecked={initial.isSupplier ?? false} />
              Lieferant
            </label>
          </div>
          <p className="field-hint">Kunden stehen bei Rechnungen und Angeboten zur Auswahl, Lieferanten bei den Belegen. Beides geht.</p>
        </fieldset>
        <div className="form-row cols-2">
          <label className="field">
            E-Mail
            <input name="email" type="email" multiple defaultValue={initial.email} autoComplete="email" placeholder="rechnung@kunde.de, freigabe@kunde.de" />
            <span className="small muted">Mehrere Adressen mit Komma trennen, bis zu fünf. Der Versand schreibt an alle.</span>
          </label>
          <label className="field">
            Telefon
            <input name="telefon" type="tel" defaultValue={initial.telefon} autoComplete="tel" placeholder="optional, z. B. +49 941 123456" />
          </label>
        </div>
        <div className="form-row cols-2">
          <label className="field">
            Kundennummer
            <input
              name="kundennummer"
              defaultValue={initial.kundennummer}
              placeholder={!contact && nextNumber ? nextNumber : "optional"}
              aria-describedby={!contact && nextNumber ? "kundennummer-hint" : undefined}
            />
            {!contact && nextNumber && (
              <span id="kundennummer-hint" className="small muted">
                Leer lassen: Haben vergibt die nächste Nummer, voraussichtlich {nextNumber}.
              </span>
            )}
          </label>
          <label className="field">
            Lieferantennummer
            <input name="lieferantennummer" defaultValue={initial.lieferantennummer} placeholder="optional, z. B. deine Kundennummer beim Lieferanten" />
          </label>
        </div>
        <div className="field-group">
          <div className="form-row cols-2">
            <label className="field">
              DATEV-Debitor
              <input
                name="debitorNr"
                defaultValue={contact?.debitorNr ?? ""}
                inputMode="numeric"
                placeholder="optional, 10000 bis 69999"
                aria-describedby="personenkonten-hint"
                className="mono"
              />
            </label>
            <label className="field">
              DATEV-Kreditor
              <input
                name="kreditorNr"
                defaultValue={contact?.kreditorNr ?? ""}
                inputMode="numeric"
                placeholder="optional, 70000 bis 99999"
                aria-describedby="personenkonten-hint"
                className="mono"
              />
            </label>
          </div>
          <p id="personenkonten-hint" className="field-hint">
            Personenkonten für den DATEV-Export an die Steuerberatung, getrennt von Kunden- und Lieferantennummer.
          </p>
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
            <input name="ustId" value={ustId} onChange={(e) => setUstId(e.target.value)} placeholder="DE123456789" className="mono" />
          </label>
          <div className="stack" style={{ gap: 4 }}>
            <label className="field">
              IBAN
              <input
                ref={ibanInput}
                name="iban"
                defaultValue={initial.iban}
                placeholder="DE00 0000 0000 0000 0000 00"
                className="mono"
                aria-describedby={ibanSuggestion ? "iban-suggestion" : undefined}
              />
            </label>
            {ibanSuggestion && <IbanSuggestionHint suggestion={ibanSuggestion} onTake={() => takeIban(ibanSuggestion.iban)} />}
          </div>
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
          <label className="field">
            Skonto
            <select value={ownSkonto ? "eigen" : "vorgabe"} onChange={(e) => setOwnSkonto(e.target.value === "eigen")}>
              <option value="vorgabe">wie in den Einstellungen</option>
              <option value="eigen">eigenes für diesen Kunden</option>
            </select>
          </label>
        </div>
        {ownSkonto && (
          <SkontoFields
            id="contact-skonto"
            rows={skontoRows}
            onChange={setSkontoRows}
            hint="Ohne Stufe bekommt dieser Kunde kein Skonto. Eine Frist, die länger ist als das Zahlungsziel der Rechnung, entfällt dort."
          />
        )}
      </section>

      {sameUstId && (
        <div className="banner" role="status" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <span>
            Mit der USt-IdNr. {sameUstId.ustId} gibt es schon „{sameUstId.name}“.
            {onPickExisting ? " Nimm ihn, statt einen zweiten Kontakt anzulegen." : ""}
          </span>
          {onPickExisting && (
            <button type="button" className="btn" onClick={() => onPickExisting(sameUstId.id)}>
              „{sameUstId.name}“ wählen
            </button>
          )}
        </div>
      )}
      <NoticeBanner notice={notice ?? (saved ? SAVED_NOTICE : null)} />
      <div className="actions form-footer">
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Abbrechen
          </button>
        ) : (
          <Link to="/kontakte" className="btn">
            Abbrechen
          </Link>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {contact ? "Speichern" : "Kontakt anlegen"}
        </button>
      </div>
    </form>
  );
}

export interface IbanSuggestion {
  iban: string;
  source: "e-rechnung" | "ki";
  /** Textausschnitt des Belegs, in dem die IBAN steht (KI-Auslesung) */
  fundstelle: string | null;
  /** Prüfziffer nach ISO 13616 stimmt */
  valid: boolean;
}

/** Vorschlag unter dem Feld: IBAN in Vierergruppen, Herkunft, Fundstelle und Prüfziffer; übernommen wird nur auf Klick */
function IbanSuggestionHint({ suggestion, onTake }: { suggestion: IbanSuggestion; onTake: () => void }) {
  return (
    <div id="iban-suggestion" className="small muted" style={{ overflowWrap: "anywhere" }}>
      Vorschlag vom Beleg: <span className="mono">{suggestion.iban.replace(/(.{4})/g, "$1 ").trim()}</span>,{" "}
      {suggestion.source === "e-rechnung" ? "aus der E-Rechnung (BT-84)" : "aus der KI-Auslesung"}
      {suggestion.fundstelle && <> („{suggestion.fundstelle}“)</>}.{" "}
      {suggestion.valid ? "Prüfziffer stimmt." : <strong style={{ color: "var(--danger-ink)" }}>Prüfziffer stimmt nicht.</strong>} Prüfe die IBAN beim
      Lieferanten, bevor du sie übernimmst.{" "}
      <button type="button" className="link-button" onClick={onTake}>
        IBAN übernehmen
      </button>
    </div>
  );
}
