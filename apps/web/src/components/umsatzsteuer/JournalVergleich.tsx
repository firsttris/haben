import { formatEuro } from "@haben/core";

/** Kennzahlen in der Reihenfolge der Voranmeldung; Kz 83 als Summe zuletzt */
const KENNZAHLEN = [
  "kz81",
  "kz86",
  "kz21",
  "kz45",
  "kz48",
  "kz41",
  "kz43",
  "kz89",
  "kz93",
  "kz46",
  "kz47",
  "kz84",
  "kz85",
  "kz66",
  "kz61",
  "kz62",
  "kz67",
  "kz39",
  "kz83",
];

/** Gespeicherte Anmeldung oder berechnete Kennzahlen; was keine Zahl ist, zählt als 0 */
type Werte = object;

/**
 * Berichtigung in einem beim Update auf das Journal übernommenen Jahr (#1200): je Kennzahl die gesendete Anmeldung, die
 * Rechnung aus dem Journal und die Differenz. Die Berichtigung beginnt mit den gesendeten Werten; die Differenz kann aus der
 * Übernahme stammen und gehört dann nicht in die Berichtigung.
 */
export function JournalVergleich({ year, gesendet, journal }: { year: number; gesendet: Werte; journal: Werte }) {
  const wert = (werte: Werte, kz: string) => {
    const v = (werte as Record<string, unknown>)[kz];
    return typeof v === "number" ? v : 0;
  };
  const zeilen = KENNZAHLEN.filter((kz) => kz === "kz81" || kz === "kz83" || wert(gesendet, kz) !== 0 || wert(journal, kz) !== 0);
  return (
    <div className="banner banner-info journal-vergleich" role="note">
      <p style={{ margin: 0 }}>
        {year} wurde beim Update auf das Journal mit Abweichungen übernommen. Die Berichtigung beginnt deshalb mit den gesendeten Werten, nicht mit der Rechnung
        aus den Buchungen. Eine Differenz kann aus der Übernahme stammen; ändere nur, was sich seit der Anmeldung wirklich geändert hat.
      </p>
      <table className="vergleich-table" aria-label="Gesendet und Journal je Kennzahl">
        <thead>
          <tr>
            <th scope="col">Kz</th>
            <th scope="col" className="num">
              Gesendet
            </th>
            <th scope="col" className="num">
              Journal
            </th>
            <th scope="col" className="num">
              Differenz
            </th>
          </tr>
        </thead>
        <tbody>
          {zeilen.map((kz) => (
            <tr key={kz}>
              <th scope="row" className="kz-num">
                {kz.slice(2)}
              </th>
              <td className="num">{formatEuro(wert(gesendet, kz))}</td>
              <td className="num">{formatEuro(wert(journal, kz))}</td>
              <td className="num">{formatEuro(wert(journal, kz) - wert(gesendet, kz))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
