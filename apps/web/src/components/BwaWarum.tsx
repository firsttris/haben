import { formatEuro, type Cents, type Warum, type WarumTeil } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { siehtSeite } from "../lib/rollen.ts";
import { ScrollTable } from "./ScrollTable.tsx";

/*
 * „Warum?“ je Zeile der BWA (#1380): die Abweichung der aufgeklappten Zeile zum Vergleich nach Kontakt, die größten einzeln,
 * der Rest als „übrige“. Die Spalte Abweichung ergibt zusammen genau die Abweichung der Zeile; sie steht darunter.
 */

const kontakte = (n: number) => (n === 1 ? "1 Kontakt" : `${n} Kontakte`);

/** „3 × 240,00 €“; ohne Vorgang null */
const vorgaenge = (anzahl: number, jeVorgang: Cents | null) => (jeVorgang === null ? null : `${anzahl}\u00a0×\u00a0${formatEuro(jeVorgang)}`);

/** „3 × 240,00 € statt 1 × 90,00 €“, bei neu nur der Zeitraum, bei weggefallen „keine statt …“ */
function vorgangText(t: WarumTeil): string {
  const jetzt = vorgaenge(t.anzahl, t.jeVorgang);
  const vorher = vorgaenge(t.anzahlVergleich, t.jeVorgangVergleich);
  if (!vorher) return jetzt ?? "";
  return `${jetzt ?? "keine"} statt ${vorher}`;
}

// Ohne Zugriff auf die Kontaktseite (Steuerberatung) nur der Name: der Link führte auf die Startseite der Rolle
function TeilZeile({ teil: t, rolle }: { teil: WarumTeil; rolle: string }) {
  return (
    <tr>
      <th scope="row">
        {t.kontaktId && siehtSeite(rolle, `/kontakte/${t.kontaktId}`) ? (
          <Link to="/kontakte/$id" params={{ id: t.kontaktId }}>
            {t.name}
          </Link>
        ) : (
          t.name
        )}
      </th>
      <td>{t.art}</td>
      <td className="num">{formatEuro(t.betrag)}</td>
      <td className="num">{formatEuro(t.vergleich)}</td>
      <td className="num">{formatEuro(t.differenz)}</td>
      <td>{vorgangText(t)}</td>
    </tr>
  );
}

export function BwaWarum({ warum, zeitraum, vergleich, rolle }: { warum: Warum; zeitraum: string; vergleich: string; rolle: string }) {
  return (
    <section className="bwa-warum" aria-labelledby="warum-titel">
      <h3 id="warum-titel">Warum?</h3>
      {warum.teile.length === 0 && warum.uebrige === null ? (
        <p className="muted">Keine Abweichung zum Vergleich.</p>
      ) : (
        <ScrollTable className="report-table">
          <caption className="visually-hidden">
            Abweichung {zeitraum} zu {vergleich} nach Kontakt
          </caption>
          <thead>
            <tr>
              <th scope="col">Kontakt</th>
              <th scope="col">Art</th>
              <th scope="col" className="num">
                {zeitraum}
              </th>
              <th scope="col" className="num">
                {vergleich}
              </th>
              <th scope="col" className="num">
                Abweichung
              </th>
              <th scope="col">Vorgänge</th>
            </tr>
          </thead>
          <tbody>
            {warum.teile.map((t) => (
              <TeilZeile key={t.schluessel} teil={t} rolle={rolle} />
            ))}
            {warum.uebrige && (
              <tr>
                <th scope="row">übrige ({kontakte(warum.uebrige.anzahlKontakte)})</th>
                <td colSpan={3} />
                <td className="num">{formatEuro(warum.uebrige.differenz)}</td>
                <td />
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Abweichung der Zeile</th>
              <td />
              <td className="num">{formatEuro(warum.betrag)}</td>
              <td className="num">{formatEuro(warum.vergleich)}</td>
              <td className="num">{formatEuro(warum.abweichung)}</td>
              <td />
            </tr>
          </tfoot>
        </ScrollTable>
      )}
      {warum.unveraendert > 0 && <p className="small muted">{kontakte(warum.unveraendert)} unverändert</p>}
    </section>
  );
}
