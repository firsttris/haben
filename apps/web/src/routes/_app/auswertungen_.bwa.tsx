import { FORM43_ZEILEN, MONTHS, bwaZeitraum, currentYear, formatEuro, type Form43Zeile, type Vergleich, type Zeitraum } from "@haben/core";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod/mini";
import { BwaWarum } from "../../components/BwaWarum.tsx";
import { Field } from "../../components/Field.tsx";
import { JOURNAL_SOURCE, ZEITRAEUME } from "../../components/Ledger.tsx";
import { ScrollTable } from "../../components/ScrollTable.tsx";
import { formatDate } from "../../lib/format.ts";
import { ERSTES_JAHR, LETZTES_JAHR } from "../../lib/jahre.ts";
import { getBwa, getBwaWarum, getBwaZeile } from "../../server/functions/bwa.ts";
import type { BwaBericht, BwaGruppe, BwaZeileWerte } from "../../server/modules/auswertungen/index.ts";
import styles from "../../styles/auswertungen.css?url";

/*
 * BWA (#1380): Einnahmen-Ausgaben-BWA nach Zufluss und Abfluss für Einzelunternehmen. Zeitraum, Vergleich und die
 * aufgeklappte Zeile stehen in der Adresse, damit eine Auswertung als Link weitergegeben werden kann. Zeiträume wie im
 * Kontenblatt (jahr, q1–q4, m1–m12), dazu „frei“ mit von und bis.
 */

const datum = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/));
const search = z.object({
  jahr: z.optional(z.int().check(z.minimum(ERSTES_JAHR), z.maximum(LETZTES_JAHR))),
  zeitraum: z.optional(z.string().check(z.regex(/^(jahr|q[1-4]|m([1-9]|1[0-2])|frei)$/))),
  von: z.optional(datum),
  bis: z.optional(datum),
  vergleich: z.optional(z.enum(["vorjahr", "vorperiode", "keiner"])),
  zeile: z.optional(z.enum(FORM43_ZEILEN)),
});
type Suche = z.infer<typeof search>;

/** Ohne Angabe: der laufende Monat, verglichen mit dem Vorjahr */
function auswahl(s: Suche): { jahr: number; art: string; zeitraum: Zeitraum; vergleich: Vergleich } {
  const jahr = s.jahr ?? currentYear();
  const art = s.zeitraum ?? `m${new Date().getMonth() + 1}`;
  const vergleich = s.vergleich ?? "vorjahr";
  if (art === "frei" && s.von && s.bis) return { jahr, art, zeitraum: { von: s.von, bis: s.bis }, vergleich };
  if (art.startsWith("q")) return { jahr, art, zeitraum: bwaZeitraum("quartal", jahr, Number(art.slice(1))), vergleich };
  if (art.startsWith("m")) return { jahr, art, zeitraum: bwaZeitraum("monat", jahr, Number(art.slice(1))), vergleich };
  return { jahr, art: art === "frei" ? "jahr" : art, zeitraum: bwaZeitraum("jahr", jahr), vergleich };
}

export const Route = createFileRoute("/_app/auswertungen_/bwa")({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const { zeitraum, vergleich } = auswahl(deps);
    const [bericht, details, warum] = await Promise.all([
      getBwa({ data: { zeitraum, vergleich } }),
      deps.zeile ? getBwaZeile({ data: { zeitraum, zeile: deps.zeile } }) : null,
      deps.zeile && vergleich !== "keiner" ? getBwaWarum({ data: { zeitraum, vergleich, zeile: deps.zeile } }) : null,
    ]);
    return { bericht, details, warum };
  },
  head: () => ({ meta: [{ title: "BWA · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: BwaPage,
});

const VERGLEICHE: [Vergleich, string][] = [
  ["vorjahr", "Vorjahreszeitraum"],
  ["vorperiode", "Vorperiode"],
  ["keiner", "Kein Vergleich"],
];

const kurzerMonat = (monat: number) => MONTHS[monat - 1]!.slice(0, 3);

/**
 * Ein Zeitraum als Text. Ausgeschrieben für die Überschrift („3. Quartal 2027“, „März 2027“, „01.03.2027–15.05.2027“), kurz
 * für die Spalten („Q3/2027“, „Mär 2027“, „01.03.–15.05.2027“, mehrere Monate „Jan–Sep 2027“). Ein ganzes Jahr ist „2027“.
 */
function zeitraumText({ von, bis }: Zeitraum, kurz = false): string {
  const [vj, vm, vt] = von.split("-").map(Number) as [number, number, number];
  const [bj, bm] = bis.split("-").map(Number) as [number, number];
  const monatsende = new Date(Date.UTC(bj, bm, 0)).getUTCDate() === Number(bis.slice(8));
  if (vt === 1 && monatsende && vj === bj) {
    if (vm === 1 && bm === 12) return String(vj);
    if (vm === bm) return kurz ? `${kurzerMonat(vm)} ${vj}` : `${MONTHS[vm - 1]} ${vj}`;
    if ((vm - 1) % 3 === 0 && bm === vm + 2) return kurz ? `Q${(vm + 2) / 3}/${vj}` : `${(vm + 2) / 3}. Quartal ${vj}`;
    if (kurz) return `${kurzerMonat(vm)}–${kurzerMonat(bm)} ${vj}`;
  }
  if (kurz && vj === bj) return `${formatDate(von).slice(0, 6)}–${formatDate(bis)}`;
  return `${formatDate(von)}–${formatDate(bis)}`;
}

/** Abweichung in Prozent mit einer Nachkommastelle, damit die Spalte bündig steht */
const prozentFormat = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
const prozent = (basispunkte: number) => `${prozentFormat.format(basispunkte / 100)}\u00a0%`;

/** Zeilen ohne Betrag in allen Spalten blenden wir aus; Summen und Ergebnis bleiben */
const leer = (z: BwaZeileWerte) => z.art === "zeile" && [z.betrag, z.kumuliert, z.vergleich ?? 0, z.vergleichKumuliert ?? 0].every((b) => b === 0);

function BwaPage() {
  const { bericht, details, warum } = Route.useLoaderData();
  const suche = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { jahr, art, zeitraum, vergleich } = auswahl(suche);
  const neu = (s: Partial<Suche>) =>
    navigate({ search: { jahr, zeitraum: art, vergleich, ...(art === "frei" ? { von: zeitraum.von, bis: zeitraum.bis } : {}), ...s } });
  const offeneZeile = suche.zeile ? bericht.zeilen.find((z) => z.key === suche.zeile) : undefined;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/auswertungen" search={{ jahr }}>
              Auswertungen
            </Link>{" "}
            › Zufluss und Abfluss
          </div>
          <h1>BWA {zeitraumText(zeitraum)}</h1>
        </div>
        <ZeitraumWahl jahr={jahr} art={art} zeitraum={zeitraum} vergleich={vergleich} neu={neu} />
      </div>

      {art === "frei" && (
        <FreierZeitraum zeitraum={zeitraum} onChange={(z) => neu({ von: z.von, bis: z.bis, jahr: Number(z.bis.slice(0, 4)), zeile: undefined })} />
      )}

      {bericht.kapitalgesellschaft ? (
        <div className="banner banner-info" role="note">
          GmbH und UG bilanzieren: Ihre BWA rechnet periodengerecht wie die GuV und kommt mit der kurzfristigen Erfolgsrechnung nach DATEV-Form 01. Bis dahin
          zeigt der <Link to="/abschluss">Jahresabschluss</Link> die GuV.
        </div>
      ) : (
        <>
          {bericht.afaOffen.length > 0 && (
            <div className="banner banner-info" role="note">
              Die Anlagen {bericht.afaOffen.join(", ")} sind im <Link to="/anlagen">Anlagenverzeichnis</Link> noch nicht gebucht. Bis dahin fehlen hier
              Abschreibungen, Restbuchwerte und die Privatnutzung von Fahrzeugen; die EÜR rechnet sie schon aus dem Anlagenverzeichnis, ihr Gewinn weicht
              deshalb ab.
            </div>
          )}
          <BwaTabelle bericht={bericht} zeitraum={zeitraum} offen={suche.zeile} />
          {offeneZeile && details && (
            <ZeileDetails titel={`${offeneZeile.label} · ${zeitraumText(zeitraum)}`} jahr={Number(zeitraum.von.slice(0, 4))} gruppen={details}>
              {warum && bericht.vergleich && (
                <BwaWarum warum={warum} zeitraum={zeitraumText(zeitraum, true)} vergleich={zeitraumText(bericht.vergleich, true)} />
              )}
            </ZeileDetails>
          )}
        </>
      )}
    </>
  );
}

function ZeitraumWahl({
  jahr,
  art,
  zeitraum,
  vergleich,
  neu,
}: {
  jahr: number;
  art: string;
  zeitraum: Zeitraum;
  vergleich: Vergleich;
  neu: (s: Partial<Suche>) => void;
}) {
  const jahre = Array.from({ length: LETZTES_JAHR - ERSTES_JAHR + 1 }, (_, i) => LETZTES_JAHR - i).filter((j) => j <= currentYear() + 1);
  return (
    <div className="actions" style={{ alignItems: "end", flexWrap: "wrap" }}>
      <Field label="Jahr">
        {(control) => (
          <select {...control} value={jahr} onChange={(e) => neu({ jahr: Number(e.target.value), zeile: undefined })} disabled={art === "frei"}>
            {jahre.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Zeitraum">
        {(control) => (
          <select
            {...control}
            value={art}
            onChange={(e) =>
              neu(
                e.target.value === "frei"
                  ? { zeitraum: "frei", von: zeitraum.von, bis: zeitraum.bis, zeile: undefined }
                  : { zeitraum: e.target.value, von: undefined, bis: undefined, zeile: undefined },
              )
            }
          >
            {ZEITRAEUME.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            <option value="frei">Von–bis</option>
          </select>
        )}
      </Field>
      <Field label="Vergleich">
        {(control) => (
          <select {...control} value={vergleich} onChange={(e) => neu({ vergleich: e.target.value as Vergleich })}>
            {VERGLEICHE.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )}
      </Field>
    </div>
  );
}

function BwaTabelle({ bericht, zeitraum, offen }: { bericht: BwaBericht; zeitraum: Zeitraum; offen: Form43Zeile | undefined }) {
  const mitVergleich = bericht.vergleich !== null;
  return (
    <section className="card">
      <h2>Einnahmen-Ausgaben-BWA</h2>
      <p className="small muted">
        Eigene Auswertung von Haben nach dem Aufbau der DATEV-Form 43, keine Auswertung von DATEV. Nach Zahlungsdatum wie die EÜR (§ 4 Abs. 3, § 11 EStG),
        Einnahmen mit Umsatzsteuer, Ausgaben mit Vorsteuer. Eine Zeile öffnet, was darin steht.
      </p>
      <ScrollTable className="report-table euer-table">
        <caption className="visually-hidden">BWA {zeitraumText(zeitraum)}</caption>
        <thead>
          <tr>
            <th scope="col">Position</th>
            <th scope="col" className="num">
              {zeitraumText(zeitraum, true)}
            </th>
            {mitVergleich && (
              <>
                <th scope="col" className="num">
                  {zeitraumText(bericht.vergleich!, true)}
                </th>
                <th scope="col" className="num">
                  Abweichung
                </th>
                <th scope="col" className="num">
                  in %
                </th>
              </>
            )}
            <th scope="col" className="num">
              Kumuliert {zeitraumText(bericht.kumuliert, true)}
            </th>
            {bericht.vergleichKumuliert && (
              <th scope="col" className="num">
                Kumuliert {zeitraumText(bericht.vergleichKumuliert, true)}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {bericht.zeilen
            .filter((z) => !leer(z))
            .map((z) => (
              <BwaZeile key={z.key} zeile={z} mitVergleich={mitVergleich} kumuliertVergleich={bericht.vergleichKumuliert !== null} offen={z.key === offen} />
            ))}
        </tbody>
      </ScrollTable>
    </section>
  );
}

function BwaZeile({
  zeile: z,
  mitVergleich,
  kumuliertVergleich,
  offen,
}: {
  zeile: BwaZeileWerte;
  mitVergleich: boolean;
  kumuliertVergleich: boolean;
  offen: boolean;
}) {
  const klasse = z.art === "summe" ? "euer-total" : z.art === "ergebnis" ? "euer-result" : undefined;
  const aufklappbar = z.art === "zeile" && (FORM43_ZEILEN as readonly string[]).includes(z.key);
  return (
    <tr className={klasse}>
      <th scope="row" className={z.art === "zeile" ? "euer-label" : undefined}>
        {aufklappbar ? (
          <Link
            from="/auswertungen/bwa"
            search={(s: Suche) => ({ ...s, zeile: offen ? undefined : (z.key as Form43Zeile) })}
            hash={offen ? undefined : "details"}
            aria-expanded={offen}
          >
            {z.label}
          </Link>
        ) : (
          z.label
        )}
      </th>
      <td className="num">{formatEuro(z.betrag)}</td>
      {mitVergleich && (
        <>
          <td className="num">{formatEuro(z.vergleich ?? 0)}</td>
          <td className="num">{formatEuro(z.abweichung?.betrag ?? 0)}</td>
          <td className="num">{z.abweichung?.prozent == null ? "–" : prozent(z.abweichung.prozent)}</td>
        </>
      )}
      <td className="num">{formatEuro(z.kumuliert)}</td>
      {kumuliertVergleich && <td className="num">{formatEuro(z.vergleichKumuliert ?? 0)}</td>}
    </tr>
  );
}

function FreierZeitraum({ zeitraum, onChange }: { zeitraum: Zeitraum; onChange: (z: Zeitraum) => void }) {
  return (
    <form
      className="card form-row cols-3 align-end"
      aria-label="Freier Zeitraum"
      onSubmit={(e) => {
        e.preventDefault();
        const daten = new FormData(e.currentTarget);
        const von = String(daten.get("von"));
        const bis = String(daten.get("bis"));
        if (von && bis && von <= bis) onChange({ von, bis });
      }}
    >
      <Field label="Von">{(control) => <input {...control} type="date" name="von" defaultValue={zeitraum.von} required />}</Field>
      <Field label="Bis">{(control) => <input {...control} type="date" name="bis" defaultValue={zeitraum.bis} required />}</Field>
      <div>
        <button type="submit" className="btn">
          Anzeigen
        </button>
      </div>
    </form>
  );
}

function ZeileDetails({ titel, jahr, gruppen, children }: { titel: string; jahr: number; gruppen: BwaGruppe[]; children?: ReactNode }) {
  return (
    <section className="card bwa-details" id="details" aria-labelledby="details-titel">
      <h2 id="details-titel">{titel}</h2>
      {children}
      {gruppen.length === 0 && <p className="muted">Keine Beträge im Zeitraum.</p>}
      {gruppen.map((g) => (
        <ScrollTable key={g.euerZeile} className="report-table">
          <caption>
            {g.konto && (
              <>
                <Link to="/konten/$konto" params={{ konto: g.konto }} search={{ jahr }} title="Kontenblatt, nach Buchungsdatum">
                  {g.konto}
                </Link>{" "}
                ·{" "}
              </>
            )}
            {g.label}: <span className="amount">{formatEuro(g.betrag)}</span>
          </caption>
          <thead>
            <tr>
              <th scope="col">Datum</th>
              <th scope="col">Vorgang</th>
              <th scope="col" className="num">
                Betrag
              </th>
            </tr>
          </thead>
          <tbody>
            {g.vorgaenge.map((v, i) => (
              <tr key={`${v.sourceId}-${i}`}>
                <td>{formatDate(v.datum)}</td>
                <td>
                  {v.rechnungId ? (
                    <Link to="/rechnungen/$id" params={{ id: v.rechnungId }}>
                      Rechnung {v.text}
                    </Link>
                  ) : v.belegId ? (
                    <Link to="/belege/$id" params={{ id: v.belegId }}>
                      Beleg {v.text}
                    </Link>
                  ) : (
                    (JOURNAL_SOURCE[v.sourceType as keyof typeof JOURNAL_SOURCE] ?? v.sourceType)
                  )}
                </td>
                <td className="num">{formatEuro(v.betrag)}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      ))}
    </section>
  );
}
