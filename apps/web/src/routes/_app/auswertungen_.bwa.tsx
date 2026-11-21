import {
  FORM01_ZEILEN,
  FORM43_ZEILEN,
  bwaZeitraum,
  currentYear,
  formatEuro,
  isKapitalgesellschaft,
  type Form01Zeile,
  type Form43Zeile,
  type Vergleich,
  type Zeitraum,
} from "@haben/core";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod/mini";
import { BwaKonten, Form01Hinweis } from "../../components/BwaForm01.tsx";
import { BwaKennzahlen } from "../../components/BwaKennzahlen.tsx";
import { BwaTabelle, zeitraumText } from "../../components/BwaTabelle.tsx";
import { BwaWarum } from "../../components/BwaWarum.tsx";
import { Field } from "../../components/Field.tsx";
import { JOURNAL_SOURCE, ZEITRAEUME } from "../../components/Ledger.tsx";
import { ScrollTable } from "../../components/ScrollTable.tsx";
import { formatDate } from "../../lib/format.ts";
import { ERSTES_JAHR, LETZTES_JAHR } from "../../lib/jahre.ts";
import { getBwa, getBwaKonten, getBwaWarum, getBwaZeile } from "../../server/functions/bwa.ts";
import type { BwaGruppe } from "../../server/modules/auswertungen/index.ts";
import styles from "../../styles/auswertungen.css?url";

/*
 * BWA (#1380): Einnahmen-Ausgaben-BWA (Form 43) nach Zufluss und Abfluss für Einzelunternehmen, Kurzfristige
 * Erfolgsrechnung (Form 01) periodengerecht für GmbH und UG. Zeitraum, Vergleich, „Leere Zeilen anzeigen“ (#1635) und die
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
  zeile: z.optional(z.enum([...new Set([...FORM43_ZEILEN, ...FORM01_ZEILEN])] as [string, ...string[]])),
  leer: z.optional(z.literal(1)),
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
  // „leer“ filtert nur die Anzeige: kein neuer Aufruf beim Umschalten
  loaderDeps: ({ search: { leer: _leer, ...deps } }) => deps,
  loader: async ({ deps, context }) => {
    const { zeitraum, vergleich } = auswahl(deps);
    // GmbH und UG: Form 01, eine Zeile öffnet ihre Konten; sonst Form 43 mit Vorgängen und „Warum?“
    const form01 = isKapitalgesellschaft(context.rechtsform);
    const zeile43 = !form01 && (FORM43_ZEILEN as readonly string[]).includes(deps.zeile ?? "") ? (deps.zeile as Form43Zeile) : undefined;
    const zeile01 = form01 && (FORM01_ZEILEN as readonly string[]).includes(deps.zeile ?? "") ? (deps.zeile as Form01Zeile) : undefined;
    const [bericht, details, warum, konten] = await Promise.all([
      getBwa({ data: { zeitraum, vergleich } }),
      zeile43 ? getBwaZeile({ data: { zeitraum, zeile: zeile43 } }) : null,
      zeile43 && vergleich !== "keiner" ? getBwaWarum({ data: { zeitraum, vergleich, zeile: zeile43 } }) : null,
      zeile01 ? getBwaKonten({ data: { zeitraum, zeile: zeile01 } }) : null,
    ]);
    return { bericht, details, warum, konten };
  },
  head: () => ({ meta: [{ title: "BWA · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: BwaPage,
});

const VERGLEICHE: [Vergleich, string][] = [
  ["vorjahr", "Vorjahreszeitraum"],
  ["vorperiode", "Vorperiode"],
  ["keiner", "Kein Vergleich"],
];

function BwaPage() {
  const { bericht, details, warum, konten } = Route.useLoaderData();
  const { user } = Route.useRouteContext();
  const suche = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { jahr, art, zeitraum, vergleich } = auswahl(suche);
  const neu = (s: Partial<Suche>) =>
    navigate({ search: { jahr, zeitraum: art, vergleich, leer: suche.leer, ...(art === "frei" ? { von: zeitraum.von, bis: zeitraum.bis } : {}), ...s } });
  const offeneZeile = suche.zeile ? bericht.zeilen.find((z) => z.key === suche.zeile) : undefined;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/auswertungen" search={{ jahr }}>
              Auswertungen
            </Link>{" "}
            › {bericht.kapitalgesellschaft ? "Periodengerecht" : "Zufluss und Abfluss"}
          </div>
          <h1>BWA {zeitraumText(zeitraum)}</h1>
        </div>
        <ZeitraumWahl jahr={jahr} art={art} zeitraum={zeitraum} vergleich={vergleich} neu={neu} />
      </div>

      {art === "frei" && (
        <FreierZeitraum zeitraum={zeitraum} onChange={(z) => neu({ von: z.von, bis: z.bis, jahr: Number(z.bis.slice(0, 4)), zeile: undefined })} />
      )}

      {bericht.afaOffen.length > 0 && (
        <div className="banner banner-info" role="note">
          Die Anlagen {bericht.afaOffen.join(", ")} sind im <Link to="/anlagen">Anlagenverzeichnis</Link> noch nicht gebucht. Bis dahin fehlen hier
          Abschreibungen
          {bericht.kapitalgesellschaft
            ? " und Restbuchwerte, ebenso in der GuV."
            : ", Restbuchwerte und die Privatnutzung von Fahrzeugen; die EÜR rechnet sie schon aus dem Anlagenverzeichnis, ihr Gewinn weicht deshalb ab."}
        </div>
      )}
      <BwaKennzahlen bericht={bericht} />
      {bericht.kapitalgesellschaft ? (
        <>
          <BwaTabelle
            bericht={bericht}
            zeitraum={zeitraum}
            offen={suche.zeile}
            leer={suche.leer === 1}
            titel="Kurzfristige Erfolgsrechnung"
            aufklappbar={FORM01_ZEILEN}
          >
            <Form01Hinweis />
          </BwaTabelle>
          {offeneZeile && konten && <BwaKonten titel={`${offeneZeile.label} · ${zeitraumText(zeitraum)}`} zeitraum={zeitraum} konten={konten} />}
        </>
      ) : (
        <>
          <BwaTabelle
            bericht={bericht}
            zeitraum={zeitraum}
            offen={suche.zeile}
            leer={suche.leer === 1}
            titel="Einnahmen-Ausgaben-BWA"
            aufklappbar={FORM43_ZEILEN}
          >
            <p className="small muted">
              Eigene Auswertung von Haben nach dem Aufbau der DATEV-Form 43, keine Auswertung von DATEV. Nach Zahlungsdatum wie die EÜR (§ 4 Abs. 3, § 11 EStG),
              Einnahmen mit Umsatzsteuer, Ausgaben mit Vorsteuer. Eine Zeile öffnet, was darin steht.
            </p>
          </BwaTabelle>
          {offeneZeile && details && (
            <ZeileDetails titel={`${offeneZeile.label} · ${zeitraumText(zeitraum)}`} jahr={Number(zeitraum.von.slice(0, 4))} gruppen={details}>
              {warum && bericht.vergleich && (
                <BwaWarum warum={warum} zeitraum={zeitraumText(zeitraum, true)} vergleich={zeitraumText(bericht.vergleich, true)} rolle={user.role} />
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
