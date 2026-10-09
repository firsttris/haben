import {
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
} from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { z } from "zod/mini";
import { errorMessage, formatDate } from "../../lib/format.ts";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { useAction, type Notice } from "../../lib/use-action.ts";
import { createPauschaleFn, getPauschalen, reversePauschaleFn } from "../../server/functions/pauschalen.ts";
import styles from "../../styles/auswertungen.css?url";

export const Route = createFileRoute("/_app/pauschalen")({
  validateSearch: z.object({ jahr: z.optional(z.int().check(z.minimum(2000), z.maximum(2100))) }),
  loaderDeps: ({ search }) => ({ year: search.jahr ?? new Date().getFullYear() }),
  loader: ({ deps }) => getPauschalen({ data: deps.year }),
  head: () => ({ meta: [{ title: "Pauschalen · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: PauschalenPage,
});

type Data = Awaited<ReturnType<typeof getPauschalen>>;
type Entry = Data["entries"][number];

const ARTEN: PauschaleArt[] = ["homeoffice", "fahrt", "verpflegung"];
const ART_KURZ: Record<PauschaleArt, string> = { homeoffice: "Homeoffice", fahrt: "Fahrt", verpflegung: "Verpflegung" };
const MAHLZEIT_LABEL = { fruehstueck: "Frühstück", mittag: "Mittagessen", abend: "Abendessen" } as const;

const parseKm = (value: string) => Number(value.replace(/\./g, "").replace(",", "."));

function detailText(entry: Entry): string {
  const d = entry.details;
  if (entry.art === "homeoffice") return `${d.tage} Tag${d.tage === 1 ? "" : "e"}`;
  if (entry.art === "fahrt") {
    const km = Number(d.km);
    const gesamt = d.hinUndZurueck ? km * 2 : km;
    return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(gesamt)} km${d.hinUndZurueck ? " (hin und zurück)" : ""} · ${FAHRZEUG_LABEL[d.fahrzeug as Fahrzeug]}`;
  }
  const gestellt = (Object.keys(MAHLZEIT_LABEL) as (keyof typeof MAHLZEIT_LABEL)[]).filter((k) => d[k]).map((k) => MAHLZEIT_LABEL[k]);
  return `${REISETAG_LABEL[d.tag as Reisetag]}${gestellt.length ? ` · gestellt: ${gestellt.join(", ")}` : ""}`;
}

function PauschalenPage() {
  const data = Route.useLoaderData();
  const { year, totals, homeoffice } = data;
  const [art, setArt] = useState<PauschaleArt>("homeoffice");
  const [notice, setNotice] = useState<Notice>(null);
  const thisYear = new Date().getFullYear();
  const years = [...new Set([thisYear, thisYear - 1, thisYear - 2, year])].sort((a, b) => b - a);
  const summe = totals.homeoffice + totals.fahrt + totals.verpflegung;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Ausgaben ohne Beleg</div>
          <h1>Pauschalen {year}</h1>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Homeoffice-Tage, Fahrten mit dem eigenen Auto und Verpflegung auf Geschäftsreisen mindern den Gewinn, ohne dass du etwas bezahlt hast,
        das einen Beleg hätte. Haben bucht sie als Ausgabe an Privateinlage und trägt sie in die richtigen Zeilen der{" "}
        <Link to="/jahreserklaerung">Anlage EÜR</Link> ein. Halte fest, wann du wo warst (Kalender, Fahrtenliste); das Finanzamt kann
        danach fragen.
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

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="kpi-label">Homeoffice</div>
          <div className="kpi-value">{formatEuro(totals.homeoffice)}</div>
          <div className="small muted">
            {homeoffice.maxTage ? `${homeoffice.tage} von ${homeoffice.maxTage} Tagen` : "erst ab 2020"}
          </div>
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
          {art === "homeoffice" && <HomeofficeForm data={data} onNotice={setNotice} />}
          {art === "fahrt" && <FahrtForm data={data} onNotice={setNotice} />}
          {art === "verpflegung" && <VerpflegungForm data={data} onNotice={setNotice} />}
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
const defaultDate = (data: Data) => (`${data.year}-12-31` < data.today ? `${data.year}-12-31` : data.today);

function HomeofficeForm({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
  const { busy, submit } = useSubmit(onNotice);
  const satz = homeofficeSatz(data.year);
  const [month, setMonth] = useState(defaultDate(data).slice(0, 7));
  const [tage, setTage] = useState("");
  const n = Number(tage) || 0;
  const rest = data.homeoffice.maxTage - data.homeoffice.tage;

  if (!satz) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Die Homeoffice-Pauschale gibt es erst ab 2020.
      </p>
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const description = String(new FormData(form).get("description") ?? "").trim();
    void submit({ art: "homeoffice", month, tage: n, description }, form, "Homeoffice-Pauschale").then((ok) => ok && setTage(""));
  }

  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={onSubmit} aria-label="Homeoffice-Pauschale">
      <p className="small muted" style={{ margin: 0 }}>
        {formatEuro(satz.proTag)} für jeden Tag, an dem du überwiegend zu Hause gearbeitet hast, höchstens {satz.maxTage} Tage im Jahr ({rest} übrig). Hast
        du ein häusliches Arbeitszimmer, das den Mittelpunkt deiner Arbeit bildet, setzt du stattdessen die Kosten oder die Jahrespauschale von 1.260 € an,
        nicht beides. Trag die Tage am besten jeden Monat ein.
      </p>
      <div className="form-grid">
        <label className="field">
          Monat
          <input
            type="month"
            value={month}
            min={`${data.year}-01`}
            max={`${data.year}-12` < data.today.slice(0, 7) ? `${data.year}-12` : data.today.slice(0, 7)}
            onChange={(e) => setMonth(e.target.value)}
            required
          />
        </label>
        <label className="field">
          Tage im Homeoffice
          <input value={tage} onChange={(e) => setTage(e.target.value.replace(/\D/g, ""))} inputMode="numeric" required />
        </label>
        <label className="field">
          Notiz (optional)
          <input name="description" maxLength={300} />
        </label>
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || n === 0}>
          {n > 0 ? `${formatEuro(n * satz.proTag)} buchen` : "Buchen"}
        </button>
      </div>
    </form>
  );
}

function FahrtForm({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
  const { busy, submit } = useSubmit(onNotice);
  const [km, setKm] = useState("");
  const [fahrzeug, setFahrzeug] = useState<Fahrzeug>("pkw");
  const [hinUndZurueck, setHinUndZurueck] = useState(true);
  const strecke = parseKm(km);
  const betrag = strecke > 0 ? fahrtBetrag(hinUndZurueck ? strecke * 2 : strecke, fahrzeug) : 0;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void submit(
      { art: "fahrt", date: String(values.get("date")), description: String(values.get("description") ?? "").trim(), km: strecke, fahrzeug, hinUndZurueck },
      form,
      "Fahrt",
    ).then((ok) => ok && setKm(""));
  }

  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={onSubmit} aria-label="Fahrt mit dem Privatfahrzeug">
      <p className="small muted" style={{ margin: 0 }}>
        Fahrten zu Kunden, Terminen und auf Geschäftsreisen mit deinem privaten Fahrzeug: {formatEuro(KM_SATZ.pkw)} je gefahrenem Kilometer mit dem Auto,{" "}
        {formatEuro(KM_SATZ.andere)} mit Motorrad oder Roller. Arbeitest du dauerhaft beim selben Kunden, kann dort eine
        Betriebsstätte entstehen; dann zählt die Entfernungspauschale, die Haben noch nicht abbildet.
      </p>
      <div className="form-grid">
        <label className="field">
          Datum
          <input name="date" type="date" defaultValue={defaultDate(data)} min={`${data.year}-01-01`} max={data.today} required />
        </label>
        <label className="field">
          Anlass und Ziel
          <input name="description" placeholder="Workshop bei Kunde, Karlsruhe" maxLength={300} required />
        </label>
        <label className="field">
          Kilometer einfach
          <input value={km} onChange={(e) => setKm(e.target.value.replace(/[^\d,.]/g, ""))} inputMode="decimal" required />
        </label>
        <label className="field">
          Fahrzeug
          <select value={fahrzeug} onChange={(e) => setFahrzeug(e.target.value as Fahrzeug)}>
            {(Object.keys(FAHRZEUG_LABEL) as Fahrzeug[]).map((f) => (
              <option key={f} value={f}>
                {FAHRZEUG_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={hinUndZurueck} onChange={(e) => setHinUndZurueck(e.target.checked)} />
        Hin und zurück (Kilometer doppelt)
      </label>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || betrag === 0}>
          {betrag > 0 ? `${formatEuro(betrag)} buchen` : "Buchen"}
        </button>
      </div>
    </form>
  );
}

function VerpflegungForm({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
  const { busy, submit } = useSubmit(onNotice);
  const [date, setDate] = useState(defaultDate(data));
  const [tag, setTag] = useState<Reisetag>("eintaegig");
  const [mahlzeiten, setMahlzeiten] = useState({ fruehstueck: false, mittag: false, abend: false });
  const jahr = Number(date.slice(0, 4)) || data.year;
  const saetze = verpflegungSaetze(jahr);
  const betrag = verpflegungBetrag(jahr, tag, mahlzeiten);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const description = String(new FormData(form).get("description") ?? "").trim();
    void submit({ art: "verpflegung", date, description, tag, ...mahlzeiten }, form, "Verpflegungsmehraufwand").then(
      (ok) => ok && setMahlzeiten({ fruehstueck: false, mittag: false, abend: false }),
    );
  }

  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={onSubmit} aria-label="Verpflegungsmehraufwand">
      <p className="small muted" style={{ margin: 0 }}>
        Je Reisetag im Inland {formatEuro(saetze.klein)} (mehr als 8 Stunden unterwegs, An- und Abreisetag) oder {formatEuro(saetze.gross)} (voller Tag).
        Hat der Kunde oder das Hotel eine Mahlzeit gestellt, zieht Haben 20 % (Frühstück) bzw. 40 % (Mittag, Abend) des vollen Satzes ab. Am selben Ort
        gibt es die Pauschale nur in den ersten drei Monaten. Eine Zeile je Reisetag.
      </p>
      <div className="form-grid">
        <label className="field">
          Datum
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} min={`${data.year}-01-01`} max={data.today} required />
        </label>
        <label className="field">
          Anlass und Ort
          <input name="description" placeholder="Kundenprojekt, München" maxLength={300} required />
        </label>
        <label className="field">
          Reisetag
          <select value={tag} onChange={(e) => setTag(e.target.value as Reisetag)}>
            {(Object.keys(REISETAG_LABEL) as Reisetag[]).map((t) => (
              <option key={t} value={t}>
                {REISETAG_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 500, marginBottom: 4 }}>
          Gestellte Mahlzeiten
        </legend>
        <div className="chip-row">
          {(Object.keys(MAHLZEIT_LABEL) as (keyof typeof MAHLZEIT_LABEL)[]).map((k) => (
            <label key={k} className="checkbox" style={{ marginRight: 12 }}>
              <input type="checkbox" checked={mahlzeiten[k]} onChange={(e) => setMahlzeiten((m) => ({ ...m, [k]: e.target.checked }))} />
              {MAHLZEIT_LABEL[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || betrag === 0}>
          {betrag > 0 ? `${formatEuro(betrag)} buchen` : "Keine Pauschale"}
        </button>
      </div>
    </form>
  );
}

function Liste({ data }: { data: Data }) {
  const router = useRouter();
  const reverse = useServerFn(reversePauschaleFn);
  const [confirm, setConfirm] = useState<string | null>(null);
  const { busy, notice, run } = useAction();

  async function storno(id: string) {
    if (confirm !== id) {
      setConfirm(id);
      return;
    }
    await run(async () => {
      await reverse({ data: id });
      setConfirm(null);
      await router.invalidate();
    });
  }

  return (
    <section className="card" aria-labelledby="liste-heading">
      <h2 id="liste-heading" style={{ margin: 0, fontSize: 16 }}>
        Eingetragen in {data.year} <span className="small muted">({data.entries.length})</span>
      </h2>
      <NoticeBanner notice={notice} />
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
                <td data-label="Datum">{e.art === "homeoffice" ? new Intl.DateTimeFormat("de-DE", { month: "long", timeZone: "UTC" }).format(new Date(`${e.date}T00:00:00Z`)) : formatDate(e.date)}</td>
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
                    <span className="pill">storniert</span>
                  ) : (
                    <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void storno(e.id)}>
                      {confirm === e.id ? "Wirklich stornieren" : "Stornieren"}
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
