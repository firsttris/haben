import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { formatDecimal, parseEuro, parsePersonenkonto } from "@haben/core";
import { useRef, useState, type FormEvent } from "react";
import { UstIdHinweis } from "./UstIdHinweis.tsx";
import { saveContact } from "../server/functions/contacts.ts";
import type { Contact, ContactInput } from "../server/modules/stammdaten/index.ts";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { parseSkontoRows, SkontoFields, toSkontoRows } from "./SkontoFields.tsx";
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

/**
 * nextNumber: Kundennummer, die Haben beim Anlegen ohne eigene Nummer vergibt; null = keine automatische Vergabe.
 * Im Dialog eines anderen Formulars (Beleg, Rechnungsentwurf, #330): prefill füllt vor, onSaved bekommt den neuen
 * Kontakt statt der Weiterleitung, onCancel ersetzt den Link zurück. Bei gleicher USt-IdNr. weist der Server auf den
 * vorhandenen Kontakt hin (UstIdHinweis); onPickExisting bietet ihn zum Wählen an, ohne ihn still zusammenzuführen.
 */
const SAVED_NOTICE = { tone: "ok", text: "Gespeichert. Die vorige Fassung bleibt als Version erhalten." } as const;

export function ContactForm({
  contact,
  nextNumber = null,
  prefill,
  onSaved,
  onCancel,
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
    const rate = text("hourlyRateCents") === "" ? null : parseEuro(text("hourlyRateCents"));
    void run(async () => {
      if (!isCustomer && !isSupplier) throw new Error("Ein Kontakt ist Kunde oder Lieferant oder beides.");
      if (!debitor.ok) throw new Error(debitor.error);
      if (!kreditor.ok) throw new Error(kreditor.error);
      if (text("hourlyRateCents") !== "" && (rate === null || rate < 0)) throw new Error("Der Stundensatz ist kein gültiger Betrag.");
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
        hourlyRateCents: rate,
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
        <Field label="Name oder Firma">
          {(control) => <input {...control} name="name" defaultValue={initial.name} required autoComplete="organization" placeholder="z. B. Muster GmbH" />}
        </Field>
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
          <Field label="E-Mail" hint="Mehrere Adressen mit Komma trennen, bis zu fünf. Der Versand schreibt an alle.">
            {(control) => (
              <input
                {...control}
                name="email"
                type="email"
                multiple
                defaultValue={initial.email}
                autoComplete="email"
                placeholder="rechnung@kunde.de, freigabe@kunde.de"
              />
            )}
          </Field>
          <Field label="Telefon">
            {(control) => (
              <input {...control} name="telefon" type="tel" defaultValue={initial.telefon} autoComplete="tel" placeholder="optional, z. B. +49 941 123456" />
            )}
          </Field>
        </div>
        <div className="form-row cols-2">
          <Field
            label="Kundennummer"
            hint={!contact && nextNumber ? `Leer lassen: Haben vergibt die nächste Nummer, voraussichtlich ${nextNumber}.` : undefined}
          >
            {(control) => (
              <input {...control} name="kundennummer" defaultValue={initial.kundennummer} placeholder={!contact && nextNumber ? nextNumber : "optional"} />
            )}
          </Field>
          <Field label="Lieferantennummer">
            {(control) => (
              <input
                {...control}
                name="lieferantennummer"
                defaultValue={initial.lieferantennummer}
                placeholder="optional, z. B. deine Kundennummer beim Lieferanten"
              />
            )}
          </Field>
        </div>
        <div className="field-group">
          <div className="form-row cols-2">
            <Field label="DATEV-Debitor" describedBy="personenkonten-hint">
              {(control) => (
                <input
                  {...control}
                  name="debitorNr"
                  defaultValue={contact?.debitorNr ?? ""}
                  inputMode="numeric"
                  placeholder="optional, 10000 bis 69999"
                  className="mono"
                />
              )}
            </Field>
            <Field label="DATEV-Kreditor" describedBy="personenkonten-hint">
              {(control) => (
                <input
                  {...control}
                  name="kreditorNr"
                  defaultValue={contact?.kreditorNr ?? ""}
                  inputMode="numeric"
                  placeholder="optional, 70000 bis 99999"
                  className="mono"
                />
              )}
            </Field>
          </div>
          <p id="personenkonten-hint" className="field-hint">
            Personenkonten für den DATEV-Export an die Steuerberatung, getrennt von Kunden- und Lieferantennummer.
          </p>
        </div>
        <div className="field-group">
          <Field label="Stundensatz (€, optional)" hint="Vorgabe für neue Leistungseinträge dieses Kunden; jeder Eintrag behält den Satz vom Anlegen.">
            {(control) => (
              <input
                {...control}
                name="hourlyRateCents"
                inputMode="decimal"
                defaultValue={contact?.hourlyRateCents == null ? "" : formatDecimal(contact.hourlyRateCents)}
                placeholder="95,00"
              />
            )}
          </Field>
        </div>
      </section>

      <section className="form-section" aria-labelledby="contact-address">
        <h2 id="contact-address">Anschrift</h2>
        <Field label="Straße und Hausnummer">
          {(control) => <input {...control} name="strasse" defaultValue={initial.strasse} autoComplete="street-address" />}
        </Field>
        <div className="form-row cols-address">
          <Field label="PLZ">{(control) => <input {...control} name="plz" defaultValue={initial.plz} autoComplete="postal-code" inputMode="numeric" />}</Field>
          <Field label="Ort">{(control) => <input {...control} name="ort" defaultValue={initial.ort} autoComplete="address-level2" />}</Field>
          <Field label="Land (ISO-Code)">
            {(control) => <input {...control} name="land" defaultValue={initial.land} maxLength={2} autoComplete="country" className="uppercase" />}
          </Field>
        </div>
      </section>

      <section className="form-section" aria-labelledby="contact-tax">
        <h2 id="contact-tax">Steuer und Zahlung</h2>
        <div className="form-row cols-2">
          <Field label="USt-IdNr.">
            {(control) => (
              <input {...control} name="ustId" value={ustId} onChange={(e) => setUstId(e.target.value)} placeholder="DE123456789" className="mono" />
            )}
          </Field>
          <div className="stack" style={{ gap: 4 }}>
            <Field label="IBAN" describedBy={ibanSuggestion ? "iban-suggestion" : undefined}>
              {(control) => (
                <input {...control} ref={ibanInput} name="iban" defaultValue={initial.iban} placeholder="DE00 0000 0000 0000 0000 00" className="mono" />
              )}
            </Field>
            {ibanSuggestion && <IbanSuggestionHint suggestion={ibanSuggestion} onTake={() => takeIban(ibanSuggestion.iban)} />}
          </div>
        </div>
        <Field label="Leitweg-ID (öffentliche Auftraggeber)" hint="Nur bei Rechnungen an Behörden nötig; steht in deren Auftrag.">
          {(control) => <input {...control} name="leitwegId" defaultValue={initial.leitwegId} className="mono" />}
        </Field>
      </section>

      <section className="form-section" aria-labelledby="contact-invoices">
        <h2 id="contact-invoices">Rechnungen</h2>
        <div className="form-row cols-2">
          <Field label="Standardformat für Rechnungen">
            {(control) => (
              <select {...control} name="defaultFormat" defaultValue={initial.defaultFormat ?? ""}>
                <option value="">wie in den Einstellungen</option>
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABEL[f]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Sprache von Rechnungen und Angeboten">
            {(control) => (
              <select {...control} name="language" defaultValue={initial.language ?? "de"}>
                <option value="de">Deutsch</option>
                <option value="en">Englisch</option>
              </select>
            )}
          </Field>
          <Field label="Skonto">
            {(control) => (
              <select {...control} value={ownSkonto ? "eigen" : "vorgabe"} onChange={(e) => setOwnSkonto(e.target.value === "eigen")}>
                <option value="vorgabe">wie in den Einstellungen</option>
                <option value="eigen">eigenes für diesen Kunden</option>
              </select>
            )}
          </Field>
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

      <UstIdHinweis
        ustId={ustId}
        {...(contact ? { excludeId: contact.id } : {})}
        wanted={{ isCustomer: prefill?.isCustomer ?? false, isSupplier: prefill?.isSupplier ?? false }}
        {...(onPickExisting ? { onPickExisting } : {})}
      />
      <NoticeBanner notice={notice ?? (saved ? SAVED_NOTICE : null)} />
      <div className="actions form-footer">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {contact ? "Speichern" : "Kontakt anlegen"}
        </button>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Abbrechen
          </button>
        ) : (
          <Link to="/kontakte" className="btn">
            Abbrechen
          </Link>
        )}
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
