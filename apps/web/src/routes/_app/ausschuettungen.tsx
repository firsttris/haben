import { formatEuro, isKapitalgesellschaft, parseEuro } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { z } from "zod";
import { ElsterSubmit } from "../../components/ElsterSubmit.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { ELSTER_KIND_LABEL, elsterNotice } from "../../lib/elster.ts";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import {
  createAusschuettungFn,
  getAusschuettungen,
  previewAusschuettung,
  reverseAusschuettungFn,
  submitKapEStFn,
} from "../../server/functions/ausschuettung.ts";
import styles from "../../styles/auswertungen.css?url";

export const Route = createFileRoute("/_app/ausschuettungen")({
  validateSearch: z.object({ jahr: z.number().int().min(2000).max(2100).optional() }),
  loaderDeps: ({ search }) => ({ jahr: search.jahr ?? new Date().getFullYear() }),
  loader: ({ deps }) => getAusschuettungen({ data: deps.jahr }),
  head: () => ({ meta: [{ title: "Ausschüttungen · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: AusschuettungenPage,
});

type Data = Awaited<ReturnType<typeof getAusschuettungen>>;
type Ausschuettung = Data["ausschuettungen"][number];
type Vorschlag = Awaited<ReturnType<typeof previewAusschuettung>>;

/** Anmeldung und Abführung bis zum 10. des Folgemonats nach dem Zufluss (§ 44 Abs. 1 Satz 5 EStG) */
function faelligkeit(zufluss: string): string {
  const [y, m] = zufluss.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-10` : `${y}-${String(m + 1).padStart(2, "0")}-10`;
}

function AusschuettungenPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const selectId = useId();
  const thisYear = new Date().getFullYear();
  const years = [...new Set([data.year, thisYear, thisYear - 1, thisYear - 2])].sort((a, b) => b - a);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Gewinnverwendung</div>
          <h1>Ausschüttungen {data.year}</h1>
        </div>
        <label className="field" htmlFor={selectId}>
          Jahr
          <select id={selectId} value={data.year} onChange={(e) => navigate({ to: "/ausschuettungen", search: { jahr: Number(e.target.value) } })}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      {isKapitalgesellschaft(data.rechtsform) ? (
        <div className="stack" style={{ gap: 24 }}>
          <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
            Eine GmbH oder UG schüttet ihren Gewinn mit einem Gewinnverwendungsbeschluss aus. Haben bucht ihn, behält Kapitalertragsteuer, Soli und
            Kirchensteuer je Gesellschafter ein und meldet sie über ELSTER an. Gesellschafter, Anteile und Kirchensteuerabzugsmerkmale stehen unter{" "}
            <Link to="/jahreserklaerung">Jahreserklärung › Angaben zu den Erklärungen</Link>.
          </p>
          <NeueAusschuettung />
          {data.ausschuettungen.length === 0 ? (
            <p className="muted">Keine Ausschüttung mit Zufluss in {data.year}.</p>
          ) : (
            data.ausschuettungen.map((a) => <AusschuettungCard key={a.id} data={data} a={a} />)
          )}
        </div>
      ) : (
        <p className="muted" style={{ maxWidth: 760 }}>
          Gewinnausschüttungen gibt es für GmbH und UG. Im Einzelunternehmen entnimmst du Gewinn als Privatentnahme.
        </p>
      )}
    </>
  );
}

function EmpfaengerTabelle({ empfaenger }: { empfaenger: Vorschlag["empfaenger"] }) {
  const summe = (f: (e: Vorschlag["empfaenger"][number]) => number) => empfaenger.reduce((s, e) => s + f(e), 0);
  const zeilen = [...empfaenger, null];
  return (
    <table className="report-table stack-table">
      <thead>
        <tr>
          <th scope="col">Gesellschafter</th>
          <th scope="col" className="num">
            Brutto
          </th>
          <th scope="col" className="num">
            Aus Einlagekonto
          </th>
          <th scope="col" className="num">
            KapESt
          </th>
          <th scope="col" className="num">
            Soli
          </th>
          <th scope="col" className="num">
            KiSt
          </th>
          <th scope="col" className="num">
            Auszuzahlen
          </th>
        </tr>
      </thead>
      <tbody>
        {zeilen.map((e) => (
          <tr key={e?.name ?? "summe"} style={e ? undefined : { fontWeight: 600 }}>
            <th scope="row">{e ? `${e.name} (${(e.anteil / 100).toLocaleString("de-DE")} %)` : "Summe"}</th>
            <td className="num" data-label="Brutto">
              {formatEuro(e ? e.brutto : summe((x) => x.brutto))}
            </td>
            <td className="num" data-label="Aus Einlagekonto">
              {formatEuro(e ? e.ausEinlagekonto : summe((x) => x.ausEinlagekonto))}
            </td>
            <td className="num" data-label="KapESt">
              {formatEuro(e ? e.kapest : summe((x) => x.kapest))}
            </td>
            <td className="num" data-label="Soli">
              {formatEuro(e ? e.soli : summe((x) => x.soli))}
            </td>
            <td className="num" data-label="KiSt">
              {formatEuro(e ? e.kist : summe((x) => x.kist))}
            </td>
            <td className="num" data-label="Auszuzahlen">
              {formatEuro(e ? e.netto : summe((x) => x.netto))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NeueAusschuettung() {
  const router = useRouter();
  const preview = useServerFn(previewAusschuettung);
  const create = useServerFn(createAusschuettungFn);
  const { busy, notice, setNotice, run } = useAction();
  const [beschluss, setBeschluss] = useState("");
  const [auszahlungstag, setAuszahlungstag] = useState("");
  const [geschaeftsjahr, setGeschaeftsjahr] = useState("");
  // Vorbelegt, bis jemand das Feld selbst ändert: Das Datumsfeld meldet beim Tippen Zwischenstände wie 0002-01-02
  const [jahrSelbstGesetzt, setJahrSelbstGesetzt] = useState(false);
  const [betrag, setBetrag] = useState("");
  const [vorschlag, setVorschlag] = useState<Vorschlag | null>(null);
  const input = () => {
    const brutto = parseEuro(betrag);
    const jahr = Number(geschaeftsjahr);
    return brutto && beschluss && Number.isInteger(jahr) && jahr > 0
      ? { beschluss, auszahlungstag: auszahlungstag || null, geschaeftsjahr: jahr, brutto }
      : null;
  };

  function berechnen(event: FormEvent) {
    event.preventDefault();
    const data = input();
    if (!data) {
      setNotice({ tone: "danger", text: "Datum des Beschlusses, Geschäftsjahr und Betrag eingeben." });
      return;
    }
    void run(async () => setVorschlag(await preview({ data })));
  }

  return (
    <section className="card" aria-labelledby="neu-heading">
      <h2 id="neu-heading" style={{ marginTop: 0 }}>
        Gewinnverwendungsbeschluss buchen
      </h2>
      <form onSubmit={berechnen} aria-label="Neue Ausschüttung" className="stack" style={{ gap: 12 }}>
        <div className="form-row cols-2">
          <label className="field">
            Datum des Beschlusses
            <input
              type="date"
              value={beschluss}
              onChange={(e) => {
                setBeschluss(e.target.value);
                // Meist beschließt die Gesellschafterversammlung über den Gewinn des Vorjahres
                if (!jahrSelbstGesetzt && /^\d{4}-/.test(e.target.value)) setGeschaeftsjahr(String(Number(e.target.value.slice(0, 4)) - 1));
                setVorschlag(null);
              }}
              required
            />
          </label>
          <label className="field">
            Auszahlungstag laut Beschluss (optional)
            <input
              type="date"
              value={auszahlungstag}
              onChange={(e) => {
                setAuszahlungstag(e.target.value);
                setVorschlag(null);
              }}
            />
          </label>
          <label className="field">
            Geschäftsjahr, dessen Gewinn ausgeschüttet wird
            <input
              inputMode="numeric"
              value={geschaeftsjahr}
              onChange={(e) => {
                setGeschaeftsjahr(e.target.value);
                setJahrSelbstGesetzt(true);
                setVorschlag(null);
              }}
              placeholder="z. B. 2025"
              required
            />
          </label>
          <label className="field">
            Ausschüttung brutto
            <input
              inputMode="decimal"
              value={betrag}
              onChange={(e) => {
                setBetrag(e.target.value);
                setVorschlag(null);
              }}
              placeholder="0,00"
              required
            />
          </label>
        </div>
        <div className="actions">
          <button type="submit" className="btn" disabled={busy}>
            Steuerabzug berechnen
          </button>
        </div>
      </form>
      {vorschlag && (
        <div className="stack" style={{ gap: 12, marginTop: 16 }} role="region" aria-label="Berechnung der Ausschüttung">
          <p className="small muted" style={{ margin: 0 }}>
            Zufluss am {formatDate(vorschlag.zufluss)}; Anmeldung bis {formatDate(faelligkeit(vorschlag.zufluss))}. Ausschüttbarer Gewinn nach § 27 KStG{" "}
            {formatEuro(vorschlag.ausschuettbarerGewinn)}
            {vorschlag.ausEinlagekonto > 0 ? `; ${formatEuro(vorschlag.ausEinlagekonto)} gehen ohne Steuerabzug aus dem Einlagekonto` : ""}.
          </p>
          <EmpfaengerTabelle empfaenger={vorschlag.empfaenger} />
          {vorschlag.issues.map((text) => (
            <div key={text} className="banner" role="status">
              {text}
            </div>
          ))}
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || vorschlag.issues.length > 0}
              onClick={() => {
                const data = input();
                if (!data) return;
                void run(async () => {
                  await create({ data });
                  setVorschlag(null);
                  setBetrag("");
                  await router.navigate({ to: "/ausschuettungen", search: { jahr: Number(vorschlag.zufluss.slice(0, 4)) } });
                  await router.invalidate();
                }, "Ausschüttung gebucht.");
              }}
            >
              Beschluss buchen
            </button>
          </div>
        </div>
      )}
      <NoticeBanner notice={notice} />
    </section>
  );
}

/** Je Gesellschafter die Steuerbescheinigung nach § 45a Abs. 2 EStG zum Herunterladen, oder was dafür fehlt */
function Steuerbescheinigungen({ a }: { a: Ausschuettung }) {
  const headingId = useId();
  return (
    <section className="stack" style={{ gap: 8, marginTop: 16 }} aria-labelledby={headingId}>
      <h3 id={headingId} style={{ margin: 0 }}>
        Steuerbescheinigungen
      </h3>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        Nach § 45a Abs. 2 EStG (amtliches Muster II), ab dem Zahlungstag. Gib jedem Gesellschafter seine Bescheinigung für die Einkommensteuererklärung und
        bewahre eine Kopie bei den Unterlagen der Ausschüttung auf. Anschrift, Identifikationsnummer und Religionsgemeinschaft kommen aus den{" "}
        <Link to="/jahreserklaerung">Angaben zu den Erklärungen</Link>.
      </p>
      <ul className="stack" style={{ gap: 8, margin: 0, paddingLeft: 20 }}>
        {a.bescheinigungen.map((b) => (
          <li key={b.nr}>
            {b.fehlend.length === 0 ? (
              <a href={`/api/steuerbescheinigung/${a.id}/${b.nr}`} download>
                Steuerbescheinigung {b.name} (PDF)
              </a>
            ) : (
              <span>
                Steuerbescheinigung {b.name}: <span className="muted">{b.fehlend.join(" ")}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AusschuettungCard({ data, a }: { data: Data; a: Ausschuettung }) {
  const router = useRouter();
  const submit = useServerFn(submitKapEStFn);
  const reverse = useServerFn(reverseAusschuettungFn);
  const { busy, notice, setNotice, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const titel = `Beschluss vom ${formatDate(a.beschlussDate)}`;
  const faellig = faelligkeit(a.zufluss);
  return (
    <section className="card" aria-label={titel}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>
          {titel}: {formatEuro(a.brutto)}
        </h2>
        <span className={`pill ${a.storniert ? "pill-danger" : a.angemeldet ? "pill-ok" : ""}`}>
          {a.storniert ? "storniert" : a.angemeldet ? "angemeldet" : `anmelden bis ${formatDate(faellig)}`}
        </span>
      </div>
      <p className="small muted">Zufluss am {formatDate(a.zufluss)}</p>
      <EmpfaengerTabelle empfaenger={a.empfaenger} />
      {!a.storniert && <Steuerbescheinigungen a={a} />}
      {!a.storniert && (
        <div className="grid-main" style={{ marginTop: 16 }}>
          <ElsterSubmit
            setup={data}
            title={`Kapitalertragsteuer-Anmeldung ${formatDate(a.zufluss)}`}
            ready
            busy={busy}
            notice={notice}
            lockedHint={a.angemeldet ? "Schon übermittelt. Eine Berichtigung geht über das ELSTER-Portal." : undefined}
            confirmText="Die Kapitalertragsteuer-Anmeldung geht verbindlich an das Finanzamt. Noch einmal klicken zum Senden."
            footer="Die einbehaltenen Steuern überweist du bis zum 10. des Folgemonats; im Bankabgleich ordnest du die Zahlung „Kapitalertragsteuer an das Finanzamt“ zu."
            onSubmit={(kind, pin) =>
              run(async () => {
                const result = await submit({ data: { id: a.id, kind, pin } });
                setNotice(elsterNotice(kind, result, "Übermittelt."));
                await router.invalidate();
              })
            }
          />
          <div className="stack" style={{ gap: 8 }}>
            {a.history.map((h) => (
              <div key={h.id} className="history-row">
                <span className="small">
                  {ELSTER_KIND_LABEL[h.kind]} <span className={`pill ${h.ok ? "pill-ok" : "pill-danger"}`}>{h.ok ? "OK" : `Fehler ${h.code}`}</span>{" "}
                  {formatDateTime(h.createdAt)}
                  {h.transferTicket ? ` · Ticket ${h.transferTicket}` : ""}
                </span>
                {h.ok && h.kind !== "validate" && (
                  <a href={`/api/protokoll/${h.id}`} target="_blank" rel="noreferrer" className="small">
                    Protokoll
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {!a.storniert && !a.angemeldet && (
        <div className="actions" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={busy}
            onClick={() =>
              confirming
                ? void run(async () => {
                    await reverse({ data: { id: a.id } });
                    await router.invalidate();
                  }, "Ausschüttung storniert.")
                : setConfirming(true)
            }
          >
            {confirming ? "Jetzt stornieren" : `${titel} stornieren`}
          </button>
        </div>
      )}
      {a.storniert && <NoticeBanner notice={notice} />}
    </section>
  );
}
