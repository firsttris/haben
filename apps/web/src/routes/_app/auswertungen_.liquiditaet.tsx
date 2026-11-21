import { HORIZONTE, HORIZONT_KEYS, addDays, formatEuro, type Horizont, type Vorschau } from "@haben/core";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod/mini";
import { BalanceChart } from "../../components/BalanceChart.tsx";
import { Field } from "../../components/Field.tsx";
import { LiquiditaetVerlauf } from "../../components/LiquiditaetVerlauf.tsx";
import { formatDate } from "../../lib/format.ts";
import { siehtSeite } from "../../lib/rollen.ts";
import { getLiquiditaet } from "../../server/functions/liquiditaet.ts";
import type { Kontostaende } from "../../server/modules/liquiditaet/index.ts";
import styles from "../../styles/auswertungen.css?url";

/*
 * Liquiditätsvorschau (#1381): Kontostand heute und was bis zum Ende des Horizonts kommt und geht, als Kurve und als Tabelle
 * je Woche bzw. Monat. Horizont, überfällige Forderungen und der aufgeklappte Zeitraum stehen in der Adresse, damit die
 * Ansicht als Link weitergegeben werden kann.
 */

const search = z.object({
  horizont: z.optional(z.enum(HORIZONT_KEYS)),
  /** false: überfällige Forderungen nicht einrechnen */
  ueberfaellige: z.optional(z.boolean()),
  /** Erster Tag des aufgeklappten Zeitraums */
  zeitraum: z.optional(z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/))),
});
type Suche = z.infer<typeof search>;

export const Route = createFileRoute("/_app/auswertungen_/liquiditaet")({
  validateSearch: search,
  loaderDeps: ({ search: { horizont, ueberfaellige } }) => ({ horizont, ueberfaellige }),
  loader: ({ deps }) => getLiquiditaet({ data: { horizont: deps.horizont ?? "13w", ueberfaellige: deps.ueberfaellige ?? true } }),
  head: () => ({ meta: [{ title: "Liquiditätsvorschau · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: LiquiditaetPage,
});

function LiquiditaetPage() {
  const { vorschau, konten } = Route.useLoaderData();
  const { user } = Route.useRouteContext();
  const suche = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const horizont = suche.horizont ?? "13w";
  const ueberfaellige = suche.ueberfaellige ?? true;
  const neu = (s: Partial<Suche>) => navigate({ search: { ...suche, zeitraum: undefined, ...s } });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/auswertungen">Auswertungen</Link> › Vorschau
          </div>
          <h1>Liquiditätsvorschau</h1>
        </div>
        <div className="actions liq-wahl">
          <Field label="Horizont">
            {(control) => (
              <select {...control} value={horizont} onChange={(e) => neu({ horizont: e.target.value as Horizont })}>
                {HORIZONT_KEYS.map((h) => (
                  <option key={h} value={h}>
                    {HORIZONTE[h].label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <label className="checkbox">
            <input type="checkbox" checked={ueberfaellige} onChange={(e) => neu({ ueberfaellige: e.target.checked ? undefined : false })} />
            Überfällige Forderungen einrechnen
          </label>
        </div>
      </div>

      <KontoHinweise konten={konten} rolle={user.role} />
      <Kennzahlen vorschau={vorschau} konten={konten} />

      <section className="card liq-kurve" aria-labelledby="liq-kurve-titel">
        <h2 id="liq-kurve-titel">Kontostand je Tag</h2>
        <BalanceChart
          title="Liquiditätsvorschau"
          from={vorschau.heute}
          to={addDays(vorschau.bis, 1)}
          start={vorschau.start}
          points={vorschau.verlauf.map((s) => ({ date: s.datum, value: s.stand, label: tagesText(vorschau, s.datum) }))}
        />
      </section>

      <section className="card" aria-labelledby="liq-verlauf-titel">
        <h2 id="liq-verlauf-titel">Verlauf</h2>
        <p className="small muted">
          Eigene Vorschau aus Kontoständen, offenen Posten, Dauerbelegen, wiederkehrenden Rechnungen, Umsatzsteuer und Vorauszahlungen; sie bucht nichts.
          Sicherheit: fest heißt Betrag und Termin stehen, erwartet heißt der Betrag kommt aus Rechnung, Voranmeldung, Vorlage oder letzter Zahlung, ob und wann
          er fließt, ist offen, geschätzt heißt Haben hat ihn gerechnet. Ein Zeitraum öffnet seine Posten.
        </p>
        <LiquiditaetVerlauf vorschau={vorschau} offen={suche.zeitraum} rolle={user.role} />
      </section>
    </>
  );
}

/** Für den Tooltip der Kurve: was an dem Tag fließt, höchstens drei Posten */
function tagesText(vorschau: Vorschau, datum: string): string {
  const posten = vorschau.zeitraeume.flatMap((z) => z.posten).filter((p) => p.datum === datum);
  const texte = posten.slice(0, 3).map((p) => p.text);
  return posten.length > 3 ? `${texte.join(", ")} und ${posten.length - 3} weitere` : texte.join(", ");
}

/** „1 Konto“, „3 Konten“: Konten im Bestand mit bekanntem Stand */
function anzahlKonten(konten: Kontostaende): string {
  const n = konten.konten.filter((k) => k.zweck !== "ruecklage" && k.stand !== null).length;
  return `${n} ${n === 1 ? "Konto" : "Konten"}`;
}

function Kennzahlen({ vorschau, konten }: { vorschau: Vorschau; konten: Kontostaende }) {
  return (
    <div className="grid-4 liq-kennzahlen">
      <div className="card">
        <div className="kpi-label">Kontostand heute</div>
        <div className="kpi-value">{formatEuro(vorschau.start)}</div>
        <div className="small muted">{anzahlKonten(konten)}</div>
      </div>
      <div className="card">
        <div className="kpi-label">Tiefpunkt</div>
        <div className={`kpi-value${vorschau.tiefpunkt.stand < 0 ? " betrag-negativ" : ""}`}>{formatEuro(vorschau.tiefpunkt.stand)}</div>
        <div className="small muted">am {formatDate(vorschau.tiefpunkt.datum)}</div>
      </div>
      <div className="card">
        <div className="kpi-label">Am Ende</div>
        <div className={`kpi-value${vorschau.ende < 0 ? " betrag-negativ" : ""}`}>{formatEuro(vorschau.ende)}</div>
        <div className="small muted">am {formatDate(vorschau.bis)}</div>
      </div>
      <div className="card">
        <div className="kpi-label">Rücklage</div>
        <div className="kpi-value">{formatEuro(konten.ruecklage)}</div>
        <div className="small muted">nicht im Kontostand</div>
      </div>
    </div>
  );
}

/** Was den Startwert unsicher macht: fehlende oder alte Kontostände, noch nicht zugeordnete Umsätze */
function KontoHinweise({ konten, rolle }: { konten: Kontostaende; rolle: string }) {
  const ohne = konten.konten.filter((k) => k.stand === null);
  const alt = konten.konten.filter((k) => k.alt && k.datum);
  const offen = konten.konten.reduce((s, k) => s + k.offeneUmsaetze, 0);
  const hinweise = [
    ...ohne.map((k) => `Für ${k.name} kennt Haben keinen Kontostand; er fehlt im Startwert.`),
    ...alt.map((k) => `Der Kontostand von ${k.name} ist vom ${formatDate(k.datum!)}.`),
    ...(offen > 0
      ? [`${offen} ${offen === 1 ? "Umsatz ist" : "Umsätze sind"} noch nicht zugeordnet; die Rechnung oder der Beleg dazu kann hier noch als offen zählen.`]
      : []),
  ];
  if (hinweise.length === 0) return null;
  return (
    <div className="banner banner-info" role="note">
      {hinweise.length === 1 ? (
        hinweise[0]
      ) : (
        <ul className="liq-hinweise">
          {hinweise.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
      {siehtSeite(rolle, "/bank") && (
        <>
          {" "}
          <Link to="/bank">Zur Bank</Link>
        </>
      )}
    </div>
  );
}
