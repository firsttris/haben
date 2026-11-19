import { formatEuro, gewinnAusPrognose } from "@haben/core";
import { useEffect, useState } from "react";
import { formatZeitraumAbJahresanfang } from "../../lib/format.ts";
import { ScrollTable } from "../../components/ScrollTable.tsx";
import type { Basis } from "./-finanzamt-daten.ts";

/**
 * Die Rechnung hinter der Vorauszahlung, zugeklappt (#1253): Das Formular zum Antrag steht vorn, der Kurzwert in der
 * Überschrift nennt das Ergebnis. Aufgeklappt, wenn die Adresse mit `#schaetzung` auf sie zeigt.
 */
export function Schaetzung({ basis: b }: { basis: Basis }) {
  const p = b.prognose;
  // Nur der Gewinn ist eine Schätzung für dieses Jahr; Arbeitslohn, Abzüge und Lohnsteuer stammen aus der letzten
  // Veranlagung. Ohne Jahr an der Zeile liest sich der Block wie eine Rechnung für b.year.
  const ausAngaben = b.angabenAus !== null && b.angabenAus < b.year ? ` (Angaben ${b.angabenAus})` : "";
  const [offen, setOffen] = useState(false);
  // Erst nach dem Laden, damit Server und Browser dasselbe zeichnen
  useEffect(() => {
    const pruefen = () => window.location.hash === "#schaetzung" && setOffen(true);
    pruefen();
    window.addEventListener("hashchange", pruefen);
    return () => window.removeEventListener("hashchange", pruefen);
  }, []);

  return (
    <details id="schaetzung" className="est-block est-block-schaetzung" open={offen} onToggle={(event) => setOffen(event.currentTarget.open)}>
      <summary>
        <span className="est-block-title">Schätzrechnung {b.year}</span>
        <span className="est-block-wert small muted">Vorauszahlung je Termin {formatEuro(p.jeQuartal)}</span>
      </summary>
      <div className="stack" style={{ gap: 12, paddingTop: 4 }}>
        <ScrollTable className="report-table">
          <tbody>
            <tr>
              <th scope="row">Gewinn {formatZeitraumAbJahresanfang(b.until)} (laufend)</th>
              <td className="num">{formatEuro(b.profitSoFar)}</td>
            </tr>
            <tr>
              <th scope="row">Hochgerechnet auf {b.year}</th>
              <td className="num">{formatEuro(b.profitForecast)}</td>
            </tr>
            <tr>
              <th scope="row">Gewinn {b.year - 1}</th>
              <td className="num">{formatEuro(b.profitLastYear)}</td>
            </tr>
          </tbody>
        </ScrollTable>
        <h3 style={{ margin: "8px 0 0", fontSize: "1rem" }}>Voraussichtliche Steuer {b.year}</h3>
        <ScrollTable className="report-table">
          <tbody>
            <tr>
              <th scope="row">Hochgerechneter Gewinn</th>
              <td className="num">{formatEuro(gewinnAusPrognose(p))}</td>
            </tr>
            {p.erstattungsueberhang > 0 && (
              <tr>
                <th scope="row">Erstattungsüberhang (§ 10 Abs. 4b Satz 3 EStG){ausAngaben}</th>
                <td className="num">{formatEuro(p.erstattungsueberhang)}</td>
              </tr>
            )}
            {p.einkuenfteArbeit !== 0 && (
              <tr>
                <th scope="row">Arbeitslohn nach Werbungskosten{ausAngaben}</th>
                <td className="num">{formatEuro(p.einkuenfteArbeit)}</td>
              </tr>
            )}
            <tr>
              <th scope="row">Vorsorge, Sonderausgaben, Kinderbetreuung, Belastungen{ausAngaben}</th>
              <td className="num">−{formatEuro(p.vorsorge + p.sonderausgaben + p.kinderbetreuung + p.aussergewoehnlich)}</td>
            </tr>
            <tr>
              <th scope="row">Zu versteuerndes Einkommen{p.kinderfreibetrag ? " (mit Kinderfreibeträgen)" : ""}</th>
              <td className="num">{formatEuro(p.zvE)}</td>
            </tr>
            <tr>
              <th scope="row">Einkommensteuer</th>
              <td className="num">{formatEuro(p.einkommensteuer)}</td>
            </tr>
            {p.soli > 0 && (
              <tr>
                <th scope="row">Solidaritätszuschlag</th>
                <td className="num">{formatEuro(p.soli)}</td>
              </tr>
            )}
            {p.kirchensteuer > 0 && (
              <tr>
                <th scope="row">Kirchensteuer</th>
                <td className="num">{formatEuro(p.kirchensteuer)}</td>
              </tr>
            )}
            {p.steuerabzug > 0 && (
              <tr>
                <th scope="row">Lohnsteuer, angerechnet{ausAngaben}</th>
                <td className="num">−{formatEuro(p.steuerabzug)}</td>
              </tr>
            )}
            <tr style={{ fontWeight: 600 }}>
              <th scope="row" style={{ fontWeight: 600 }}>
                Je Vorauszahlungstermin (ein Viertel)
              </th>
              <td className="num">{formatEuro(p.jeQuartal)}</td>
            </tr>
          </tbody>
        </ScrollTable>
      </div>
    </details>
  );
}
