import {
  fahrtBetrag,
  FAHRZEUG_LABEL,
  formatEuro,
  homeofficeSatz,
  KM_SATZ,
  REISETAG_LABEL,
  verpflegungBetrag,
  verpflegungSaetze,
  type Fahrzeug,
  type Reisetag,
} from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { errorMessage } from "../../lib/format.ts";
import type { Notice } from "../../lib/use-action.ts";
import { datumFehler, monatFehler, useSubmitCheck } from "../../lib/use-submit-check.ts";
import { createPauschaleFn, type getPauschalen } from "../../server/functions/pauschalen.ts";
import { EntfernungForm } from "../../components/EntfernungForm.tsx";
import { Field } from "../../components/Field.tsx";
import { MonthPicker } from "../../components/MonthPicker.tsx";

export type Data = Awaited<ReturnType<typeof getPauschalen>>;

export const MAHLZEIT_LABEL = { fruehstueck: "Frühstück", mittag: "Mittagessen", abend: "Abendessen" } as const;

export const parseKm = (value: string) => Number(value.replace(/\./g, "").replace(",", "."));

/** Sendet die Eingabe, lädt neu und meldet das Ergebnis */
export function useSubmit(onNotice: (n: Notice) => void) {
  const router = useRouter();
  const create = useServerFn(createPauschaleFn);
  const [busy, setBusy] = useState(false);
  async function submit(input: Parameters<typeof create>[0]["data"], form: HTMLFormElement, label: string) {
    setBusy(true);
    onNotice(null);
    try {
      const result = await create({ data: input });
      await router.invalidate();
      form.reset();
      onNotice({ tone: "ok", text: `${label} über ${formatEuro(result.amount)} gebucht.` });
      return true;
    } catch (error) {
      onNotice({ tone: "danger", text: errorMessage(error) });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, submit };
}

/** Heute im laufenden Jahr, sonst der letzte Tag des gewählten Jahres */
export const defaultDate = (data: Data) => (`${data.year}-12-31` < data.today ? `${data.year}-12-31` : data.today);

export function HomeofficeForm({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
  const { busy, submit } = useSubmit(onNotice);
  const satz = homeofficeSatz(data.year);
  const [month, setMonth] = useState(defaultDate(data).slice(0, 7));
  const [tage, setTage] = useState("");
  const n = Number(tage) || 0;
  const rest = data.homeoffice.maxTage - data.homeoffice.tage;
  const { form, error, check } = useSubmitCheck({
    month: monatFehler(month, `${data.year}-01`, defaultDate(data).slice(0, 7)),
    tage: tage === "" ? "Trag die Tage ein." : n === 0 ? "Mindestens ein Tag." : null,
  });

  if (!satz) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Die Homeoffice-Pauschale gibt es erst ab 2020.
      </p>
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check()) return;
    const element = event.currentTarget;
    const description = String(new FormData(element).get("description") ?? "").trim();
    void submit({ art: "homeoffice", month, tage: n, description }, element, "Homeoffice-Pauschale").then((ok) => ok && setTage(""));
  }

  return (
    <form ref={form} className="stack" style={{ gap: 12 }} onSubmit={onSubmit} aria-label="Homeoffice-Pauschale" noValidate>
      <p className="small muted" style={{ margin: 0 }}>
        {formatEuro(satz.proTag)} für jeden Tag, an dem du überwiegend zu Hause gearbeitet hast, höchstens {satz.maxTage} Tage im Jahr ({rest} übrig). Hast du
        ein häusliches Arbeitszimmer, das den Mittelpunkt deiner Arbeit bildet, setzt du stattdessen die Kosten oder die Jahrespauschale von 1.260 € an, nicht
        beides. Trag die Tage am besten jeden Monat ein.
      </p>
      <div className="form-grid">
        <Field label="Monat" error={error("month")}>
          {(control) => <MonthPicker {...control} value={month} min={`${data.year}-01`} max={defaultDate(data).slice(0, 7)} onChange={setMonth} />}
        </Field>
        <Field label="Tage im Homeoffice" error={error("tage")}>
          {(control) => <input {...control} value={tage} onChange={(e) => setTage(e.target.value.replace(/\D/g, ""))} inputMode="numeric" required />}
        </Field>
        <Field label="Notiz (optional)">{(control) => <input {...control} name="description" maxLength={300} />}</Field>
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {n > 0 ? `${formatEuro(n * satz.proTag)} buchen` : "Buchen"}
        </button>
      </div>
    </form>
  );
}

export function FahrtForm({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
  const { busy, submit } = useSubmit(onNotice);
  const [date, setDate] = useState(defaultDate(data));
  const [anlass, setAnlass] = useState("");
  const [km, setKm] = useState("");
  const [fahrzeug, setFahrzeug] = useState<Fahrzeug>("pkw");
  const [hinUndZurueck, setHinUndZurueck] = useState(true);
  const strecke = parseKm(km);
  const betrag = strecke > 0 ? fahrtBetrag(hinUndZurueck ? strecke * 2 : strecke, fahrzeug) : 0;
  const { form, error, check } = useSubmitCheck({
    date: datumFehler(date, `${data.year}-01-01`, data.today),
    anlass: anlass.trim() === "" ? "Trag Anlass und Ziel ein." : null,
    km: km === "" ? "Trag die Kilometer ein." : strecke > 0 ? null : "Trag mehr als 0 Kilometer ein.",
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check()) return;
    void submit({ art: "fahrt", date, description: anlass.trim(), km: strecke, fahrzeug, hinUndZurueck }, event.currentTarget, "Fahrt").then((ok) => {
      if (!ok) return;
      setDate(defaultDate(data));
      setAnlass("");
      setKm("");
    });
  }

  return (
    <form ref={form} className="stack" style={{ gap: 12 }} onSubmit={onSubmit} aria-label="Fahrt mit dem Privatfahrzeug" noValidate>
      <p className="small muted" style={{ margin: 0 }}>
        Fahrten zu Kunden, Terminen und auf Geschäftsreisen mit deinem privaten Fahrzeug: {formatEuro(KM_SATZ.pkw)} je gefahrenem Kilometer mit dem Auto,{" "}
        {formatEuro(KM_SATZ.andere)} mit Motorrad oder Roller. Arbeitest du dauerhaft beim selben Kunden, kann dort eine Betriebsstätte entstehen; dann zählen
        die Wege dorthin als „Wege zur Betriebsstätte“ mit der Entfernungspauschale, nicht mit dem Kilometersatz.
      </p>
      <div className="form-grid">
        <Field label="Datum" error={error("date")}>
          {(control) => (
            <input {...control} type="date" value={date} onChange={(e) => setDate(e.target.value)} min={`${data.year}-01-01`} max={data.today} required />
          )}
        </Field>
        <Field label="Anlass und Ziel" error={error("anlass")}>
          {(control) => (
            <input
              {...control}
              value={anlass}
              onChange={(e) => setAnlass(e.target.value)}
              placeholder="Workshop bei Kunde, Karlsruhe"
              maxLength={300}
              required
            />
          )}
        </Field>
        <Field label="Kilometer einfach" error={error("km")}>
          {(control) => <input {...control} value={km} onChange={(e) => setKm(e.target.value.replace(/[^\d,.]/g, ""))} inputMode="decimal" required />}
        </Field>
        <Field label="Fahrzeug">
          {(control) => (
            <select {...control} value={fahrzeug} onChange={(e) => setFahrzeug(e.target.value as Fahrzeug)}>
              {(Object.keys(FAHRZEUG_LABEL) as Fahrzeug[]).map((f) => (
                <option key={f} value={f}>
                  {FAHRZEUG_LABEL[f]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={hinUndZurueck} onChange={(e) => setHinUndZurueck(e.target.checked)} />
        Hin und zurück (Kilometer doppelt)
      </label>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {betrag > 0 ? `${formatEuro(betrag)} buchen` : "Buchen"}
        </button>
      </div>
    </form>
  );
}

/** Wege zur Betriebsstätte: das Formular steht in `EntfernungForm`, hier hängt es an Senden und Meldung der Seite */
export function EntfernungTab({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
  const { busy, submit } = useSubmit(onNotice);
  return (
    <EntfernungForm
      year={data.year}
      monat={defaultDate(data).slice(0, 7)}
      busy={busy}
      onSubmit={(input, form) => submit({ art: "entfernung", ...input }, form, "Entfernungspauschale")}
    />
  );
}

export function VerpflegungForm({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
  const { busy, submit } = useSubmit(onNotice);
  const [date, setDate] = useState(defaultDate(data));
  const [anlass, setAnlass] = useState("");
  const [tag, setTag] = useState<Reisetag>("eintaegig");
  const [mahlzeiten, setMahlzeiten] = useState({ fruehstueck: false, mittag: false, abend: false });
  const jahr = Number(date.slice(0, 4)) || data.year;
  const saetze = verpflegungSaetze(jahr);
  const betrag = verpflegungBetrag(jahr, tag, mahlzeiten);
  const { form, error, check } = useSubmitCheck({
    date: datumFehler(date, `${data.year}-01-01`, data.today),
    anlass: anlass.trim() === "" ? "Trag Anlass und Ort ein." : null,
    mahlzeiten: betrag === 0 ? "Nach Abzug der gestellten Mahlzeiten bleibt keine Pauschale." : null,
  });
  // Die Mahlzeiten sind Kontrollkästchen ohne Field: Fehler und Verweis darauf stehen hier
  const mahlzeitenFehlerId = useId();
  const mahlzeitenFehler = error("mahlzeiten");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check()) return;
    void submit({ art: "verpflegung", date, description: anlass.trim(), tag, ...mahlzeiten }, event.currentTarget, "Verpflegungsmehraufwand").then((ok) => {
      if (!ok) return;
      setAnlass("");
      setMahlzeiten({ fruehstueck: false, mittag: false, abend: false });
    });
  }

  return (
    <form ref={form} className="stack" style={{ gap: 12 }} onSubmit={onSubmit} aria-label="Verpflegungsmehraufwand" noValidate>
      <p className="small muted" style={{ margin: 0 }}>
        Je Reisetag im Inland {formatEuro(saetze.klein)} (mehr als 8 Stunden unterwegs, An- und Abreisetag) oder {formatEuro(saetze.gross)} (voller Tag). Hat
        der Kunde oder das Hotel eine Mahlzeit gestellt, zieht Haben 20 % (Frühstück) bzw. 40 % (Mittag, Abend) des vollen Satzes ab. Am selben Ort gibt es die
        Pauschale nur in den ersten drei Monaten. Eine Zeile je Reisetag.
      </p>
      <div className="form-grid">
        <Field label="Datum" error={error("date")}>
          {(control) => (
            <input {...control} type="date" value={date} onChange={(e) => setDate(e.target.value)} min={`${data.year}-01-01`} max={data.today} required />
          )}
        </Field>
        <Field label="Anlass und Ort" error={error("anlass")}>
          {(control) => (
            <input {...control} value={anlass} onChange={(e) => setAnlass(e.target.value)} placeholder="Kundenprojekt, München" maxLength={300} required />
          )}
        </Field>
        <Field label="Reisetag">
          {(control) => (
            <select {...control} value={tag} onChange={(e) => setTag(e.target.value as Reisetag)}>
              {(Object.keys(REISETAG_LABEL) as Reisetag[]).map((t) => (
                <option key={t} value={t}>
                  {REISETAG_LABEL[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 500, marginBottom: 4 }}>
          Gestellte Mahlzeiten
        </legend>
        <div className="chip-row">
          {(Object.keys(MAHLZEIT_LABEL) as (keyof typeof MAHLZEIT_LABEL)[]).map((k) => (
            <label key={k} className="checkbox" style={{ marginRight: 12 }}>
              <input
                type="checkbox"
                checked={mahlzeiten[k]}
                onChange={(e) => setMahlzeiten((m) => ({ ...m, [k]: e.target.checked }))}
                aria-invalid={mahlzeitenFehler ? true : undefined}
                aria-describedby={mahlzeitenFehler ? mahlzeitenFehlerId : undefined}
              />
              {MAHLZEIT_LABEL[k]}
            </label>
          ))}
        </div>
        {mahlzeitenFehler && (
          <span id={mahlzeitenFehlerId} className="field-error">
            {mahlzeitenFehler}
          </span>
        )}
      </fieldset>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {betrag > 0 ? `${formatEuro(betrag)} buchen` : "Buchen"}
        </button>
      </div>
    </form>
  );
}
