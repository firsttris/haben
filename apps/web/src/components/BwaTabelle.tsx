import { MONTHS, bwaZeileLeer, formatEuro, sichtbareZeilen, type BasisPoints, type Zeitraum } from "@haben/core";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { formatDate } from "../lib/format.ts";
import type { BwaBericht, BwaZeileWerte } from "../server/modules/auswertungen/index.ts";
import { ScrollTable } from "./ScrollTable.tsx";

/*
 * Tabelle der BWA (#1380) für Form 43 und Form 01: Zeitraum mit Anteil (#1635), Vergleich mit Abweichung, kumuliert; eine
 * Zeile öffnet sich per Link. „Leere Zeilen anzeigen“ (#1635) setzt `leer` in der Adresse.
 */

const kurzerMonat = (monat: number) => MONTHS[monat - 1]!.slice(0, 3);

/**
 * Ein Zeitraum als Text. Ausgeschrieben für die Überschrift („3. Quartal 2027“, „März 2027“, „01.03.2027–15.05.2027“), kurz
 * für die Spalten („Q3/2027“, „Mär 2027“, „01.03.–15.05.2027“, mehrere Monate „Jan–Sep 2027“). Ein ganzes Jahr ist „2027“.
 */
export function zeitraumText({ von, bis }: Zeitraum, kurz = false): string {
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

/** Anteil und Kennzahl: eine Nachkommastelle, ohne Plus; „–“ ohne Wert */
const anteilFormat = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const anteilText = (wert: BasisPoints | null) => (wert === null ? "–" : `${anteilFormat.format(wert / 100)}\u00a0%`);

const ANTEIL_43 = "Erlöse in % der Summe der Erlöse, Kosten in % der Summe der Kosten";
const ANTEIL_01 = "Leistung und Material in % der Gesamtleistung, Kostenarten in % der Gesamtkosten";

export function BwaTabelle({
  bericht,
  zeitraum,
  offen,
  leer,
  titel,
  aufklappbar,
  children,
}: {
  bericht: BwaBericht;
  zeitraum: Zeitraum;
  offen: string | undefined;
  /** Auch Zeilen, die in allen Spalten 0 sind */
  leer: boolean;
  titel: string;
  /** Zeilen mit Beträgen, die sich öffnen lassen */
  aufklappbar: readonly string[];
  children: ReactNode;
}) {
  const mitVergleich = bericht.vergleich !== null;
  const navigate = useNavigate({ from: "/auswertungen/bwa" });
  return (
    <section className="card">
      <div className="chart-head bwa-kopf">
        <h2>{titel}</h2>
        <label className="checkbox">
          <input type="checkbox" checked={leer} onChange={(e) => navigate({ search: (s) => ({ ...s, leer: e.target.checked ? 1 : undefined }) })} />
          Leere Zeilen anzeigen
        </label>
      </div>
      {children}
      <p className="small muted">Anteil: {bericht.kapitalgesellschaft ? ANTEIL_01 : ANTEIL_43}.</p>
      <ScrollTable className="report-table euer-table">
        <caption className="visually-hidden">BWA {zeitraumText(zeitraum)}</caption>
        <thead>
          <tr>
            <th scope="col">Position</th>
            <th scope="col" className="num">
              {zeitraumText(zeitraum, true)}
            </th>
            <th scope="col" className="num">
              Anteil
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
          {sichtbareZeilen(bericht.zeilen, leer).map((z) => (
            <BwaZeile
              key={z.key}
              zeile={z}
              mitVergleich={mitVergleich}
              kumuliertVergleich={bericht.vergleichKumuliert !== null}
              offen={z.key === offen}
              aufklappbar={z.art === "zeile" && aufklappbar.includes(z.key)}
            />
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
  aufklappbar,
}: {
  zeile: BwaZeileWerte;
  mitVergleich: boolean;
  kumuliertVergleich: boolean;
  offen: boolean;
  aufklappbar: boolean;
}) {
  // Leere Zeilen (nur mit „Leere Zeilen anzeigen“) leise wie in der EÜR
  const klasse = z.art === "summe" ? "euer-total" : z.art === "ergebnis" ? "euer-result" : bwaZeileLeer(z) ? "euer-zero" : undefined;
  return (
    <tr className={klasse}>
      <th scope="row" className={z.art === "zeile" ? "euer-label" : undefined}>
        {aufklappbar ? (
          <Link
            from="/auswertungen/bwa"
            search={(s) => ({ ...s, zeile: offen ? undefined : z.key })}
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
      <td className="num">{anteilText(z.anteil)}</td>
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
