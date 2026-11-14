import {
  currentYear,
  fahrtBetrag,
  FAHRZEUG_LABEL,
  formatEuro,
  homeofficeSatz,
  KM_SATZ,
  PAUSCHALE_LABEL,
  REISETAG_LABEL,
  verpflegungBetrag,
  verpflegungSaetze,
  type Fahrzeug,
  type PauschaleArt,
  type Reisetag,
  isKapitalgesellschaft,
} from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { z } from "zod/mini";
import { errorMessage, formatDate } from "../../lib/format.ts";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { useAction, type Notice } from "../../lib/use-action.ts";
import { datumFehler, monatFehler, useSubmitCheck } from "../../lib/use-submit-check.ts";
import { createPauschaleFn, getPauschalen, reversePauschaleFn } from "../../server/functions/pauschalen.ts";
import styles from "../../styles/auswertungen.css?url";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { EntfernungForm } from "../../components/EntfernungForm.tsx";
import { Field } from "../../components/Field.tsx";
import { Status } from "../../components/Status.tsx";

export const Route = createFileRoute("/_app/pauschalen")({
  validateSearch: z.object({ jahr: z.optional(z.int().check(z.minimum(2000), z.maximum(2100))) }),
  loaderDeps: ({ search }) => ({ year: search.jahr ?? currentYear() }),
  loader: ({ deps }) => getPauschalen({ data: deps.year }),
  head: () => ({ meta: [{ title: "Pauschalen · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: PauschalenPage,
});

type Data = Awaited<ReturnType<typeof getPauschalen>>;
type Entry = Data["entries"][number];

const ARTEN: PauschaleArt[] = ["homeoffice", "fahrt", "verpflegung", "entfernung"];
const ART_KURZ: Record<PauschaleArt, string> = {
  homeoffice: "Homeoffice",
  fahrt: "Fahrt",
  verpflegung: "Verpflegung",
  entfernung: "Wege zur Betriebsstätte",
};
const MAHLZEIT_LABEL = { fruehstueck: "Frühstück", mittag: "Mittagessen", abend: "Abendessen" } as const;

/** Homeoffice und Wege zur Betriebsstätte gelten für einen Monat, die anderen Pauschalen für einen Tag */
function pauschaleDatum(e: { art: string; date: string }): string {
  return e.art === "homeoffice" || e.art === "entfernung"
    ? new Intl.DateTimeFormat("de-DE", { month: "long", timeZone: "UTC" }).format(new Date(`${e.date}T00:00:00Z`))
    : formatDate(e.date);
}

const parseKm = (value: string) => Number(value.replace(/\./g, "").replace(",", "."));

function detailText(entry: Entry): string {
  const d = entry.details;
  if (entry.art === "homeoffice") return `${d.tage} Tag${d.tage === 1 ? "" : "e"}`;
  if (entry.art === "entfernung") return `${d.tage} Tag${d.tage === 1 ? "" : "e"} × ${d.km} km einfache Entfernung`;
  if (entry.art === "fahrt") {
    const km = Number(d.km);
    const gesamt = d.hinUndZurueck ? km * 2 : km;
    return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(gesamt)} km${d.hinUndZurueck ? " (hin und zurück)" : ""} · ${FAHRZEUG_LABEL[d.fahrzeug as Fahrzeug]}`;
  }
  const gestellt = (Object.keys(MAHLZEIT_LABEL) as (keyof typeof MAHLZEIT_LABEL)[]).filter((k) => d[k]).map((k) => MAHLZEIT_LABEL[k]);
  return `${REISETAG_LABEL[d.tag as Reisetag]}${gestellt.length ? ` · gestellt: ${gestellt.join(", ")}` : ""}`;
}

function PauschalenPage() {
  const { rechtsform } = Route.useRouteContext();
  if (isKapitalgesellschaft(rechtsform)) return <OnlyEinzelunternehmen />;
  return <PauschalenList />;
}

/** GmbH und UG: keine Pauschalen; Auslagen des Gesellschafters gehen mit Beleg auf das Verrechnungskonto */
function OnlyEinzelunternehmen() {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Ausgaben ohne Beleg</div>
          <h1>Pauschalen</h1>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Pauschalen gibt es nur im Einzelunternehmen. Erstattet die Gesellschaft dem Gesellschafter Reisekosten oder Auslagen, lade die Abrechnung unter{" "}
        <Link to="/belege">Belege</Link> hoch und wähle „Vom Gesellschafter ausgelegt“.
      </p>
    </>
  );
}

function PauschalenList() {
  const data = Route.useLoaderData();
  const { year, totals, homeoffice } = data;
  const [art, setArt] = useState<PauschaleArt>("homeoffice");
  const [notice, setNotice] = useState<Notice>(null);
  const thisYear = currentYear();
  const years = [...new Set([thisYear, thisYear - 1, thisYear - 2, year])].sort((a, b) => b - a);
  const summe = totals.homeoffice + totals.fahrt + totals.verpflegung + totals.entfernung;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Ausgaben ohne Beleg</div>
          <h1>Pauschalen {year}</h1>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Homeoffice-Tage, Fahrten mit dem eigenen Auto, Wege zur Betriebsstätte und Verpflegung auf Geschäftsreisen mindern den Gewinn, ohne dass du etwas
        bezahlt hast, das einen Beleg hätte. Haben bucht sie als Ausgabe an Privateinlage und trägt sie in die richtigen Zeilen der{" "}
        <Link to="/jahreserklaerung">Anlage EÜR</Link> ein. Halte fest, wann du wo warst (Kalender, Fahrtenliste); das Finanzamt kann danach fragen.
      </p>

      <nav className="filter-row" aria-label="Jahr wählen">
        <div className="chip-row">
          {years.map((y) => (
            <Link key={y} to="/pauschalen" search={{ jahr: y }} className={y === year ? "chip active" : "chip"} aria-current={y === year ? "page" : undefined}>
              {y}
            </Link>
          ))}
        </div>
      </nav>

      <div className="grid-5" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="kpi-label">Homeoffice</div>
          <div className="kpi-value">{formatEuro(totals.homeoffice)}</div>
          <div className="small muted">{homeoffice.maxTage ? `${homeoffice.tage} von ${homeoffice.maxTage} Tagen` : "erst ab 2020"}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Fahrten</div>
          <div className="kpi-value">{formatEuro(totals.fahrt)}</div>
          <div className="small muted">0,30 € je km mit dem Auto</div>
        </div>
        <div className="card">
          <div className="kpi-label">Verpflegung</div>
          <div className="kpi-value">{formatEuro(totals.verpflegung)}</div>
          <div className="small muted">Mehraufwand auf Reisen</div>
        </div>
        <div className="card">
          <div className="kpi-label">Wege zur Betriebsstätte</div>
          <div className="kpi-value">{formatEuro(totals.entfernung)}</div>
          <div className="small muted">Entfernungspauschale</div>
        </div>
        <div className="card">
          <div className="kpi-label">Zusammen {year}</div>
          <div className="kpi-value">{formatEuro(summe)}</div>
          <div className="small muted">weniger Gewinn laut EÜR</div>
        </div>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        <section className="card" aria-labelledby="neu-heading">
          <h2 id="neu-heading" style={{ margin: 0, fontSize: 16 }}>
            Pauschale eintragen
          </h2>
          <div className="mode-switch" role="group" aria-label="Art der Pauschale">
            {ARTEN.map((a) => (
              <button
                key={a}
                type="button"
                className={`chip${art === a ? " active" : ""}`}
                aria-pressed={art === a}
                onClick={() => {
                  setArt(a);
                  setNotice(null);
                }}
              >
                {ART_KURZ[a]}
              </button>
            ))}
          </div>
          {/* key: Ein anderes Jahr setzt die Formulare neu auf, samt Vorgabedatum und Grenzen des Jahres */}
          {art === "homeoffice" && <HomeofficeForm key={year} data={data} onNotice={setNotice} />}
          {art === "fahrt" && <FahrtForm key={year} data={data} onNotice={setNotice} />}
          {art === "verpflegung" && <VerpflegungForm key={year} data={data} onNotice={setNotice} />}
          {art === "entfernung" && <EntfernungTab key={year} data={data} onNotice={setNotice} />}
          <NoticeBanner notice={notice} />
        </section>

        <Liste data={data} />
      </div>
    </>
  );
}

/** Sendet die Eingabe, lädt neu und meldet das Ergebnis */
function useSubmit(onNotice: (n: Notice) => void) {
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
// biome-ignore lint/complexity/useMathMinMax: Datumstexte (JJJJ-MM-TT), Math.min ergäbe NaN
const defaultDate = (data: Data) => (`${data.year}-12-31` < data.today ? `${data.year}-12-31` : data.today);

function HomeofficeForm({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
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
          {(control) => (
            <input
              {...control}
              type="month"
              value={month}
              min={`${data.year}-01`}
              max={defaultDate(data).slice(0, 7)}
              onChange={(e) => setMonth(e.target.value)}
              required
            />
          )}
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

function FahrtForm({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
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
function EntfernungTab({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
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

function VerpflegungForm({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
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

function Liste({ data }: { data: Data }) {
  const router = useRouter();
  const reverse = useServerFn(reversePauschaleFn);
  const [confirm, setConfirm] = useState<(typeof data.entries)[number] | null>(null);
  const { busy, notice, run } = useAction();

  function storno(id: string) {
    void run(async () => {
      await reverse({ data: id });
      await router.invalidate();
    });
  }

  return (
    <section className="card" aria-labelledby="liste-heading">
      <h2 id="liste-heading" style={{ margin: 0, fontSize: 16 }}>
        Eingetragen in {data.year} <span className="small muted">({data.entries.length})</span>
      </h2>
      <NoticeBanner notice={notice} />
      <ConfirmDialog
        open={confirm !== null}
        title={`${confirm ? PAUSCHALE_LABEL[confirm.art] : ""} stornieren?`}
        facts={
          confirm
            ? [
                { label: "Datum", value: pauschaleDatum(confirm) },
                { label: "Betrag", value: formatEuro(confirm.amount), strong: true },
              ]
            : undefined
        }
        confirmLabel="Stornieren"
        danger
        onConfirm={() => confirm && storno(confirm.id)}
        onClose={() => setConfirm(null)}
      >
        <p>Haben schreibt eine Gegenzeile mit negativem Betrag und eine Gegenbuchung am selben Tag. Das Original bleibt durchgestrichen stehen.</p>
      </ConfirmDialog>
      {data.entries.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Noch keine Pauschalen für {data.year}.
        </p>
      ) : (
        <table className="report-table stack-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: 120 }}>
                Datum
              </th>
              <th scope="col">Pauschale</th>
              <th scope="col" className="num" style={{ width: 110 }}>
                Betrag
              </th>
              <th scope="col" style={{ width: 150 }}>
                <span className="visually-hidden">Aktion</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.id} style={e.storniert ? { color: "var(--muted)" } : undefined}>
                <td data-label="Datum">{pauschaleDatum(e)}</td>
                <td data-label="Pauschale">
                  <span style={{ fontWeight: 500, textDecoration: e.storniert ? "line-through" : undefined }}>
                    {PAUSCHALE_LABEL[e.art]}
                    {e.description ? `: ${e.description}` : ""}
                  </span>
                  <div className="small muted">{detailText(e)}</div>
                </td>
                <td data-label="Betrag" className="num">
                  {formatEuro(e.amount)}
                </td>
                <td>
                  {e.storniert ? (
                    <Status tone="danger">Storniert</Status>
                  ) : (
                    <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => setConfirm(e)}>
                      Stornieren
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
