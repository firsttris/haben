import { Link } from "@tanstack/react-router";

/** Spalten der Umsatzliste, nach denen sich sortieren lässt (#681). */
export type SortFeld = "datum" | "gegenpartei" | "betrag" | "status";
export type SortRichtung = "auf" | "ab";

type Props = { sort?: SortFeld; dir?: SortRichtung };

/**
 * Kopfzeile der Umsatzliste. Jeder Kopf sortiert die Liste; ein zweiter Klick auf denselben Kopf
 * dreht die Richtung. Ohne Angabe steht der neueste Umsatz oben.
 *
 * Sortiert wird auf dem Server (modules/bank/umsatzliste.ts): Datum, Gegenpartei und Betrag in der Datenbank vor der
 * Grenze von 500 Umsätzen, der Status danach über die geladenen Umsätze.
 *
 * Kein aria-sort: Das Attribut ist nur auf Zellen mit der Rolle columnheader zulässig, und die
 * Liste ist keine Tabelle. Die Richtung steht deshalb im Link-Text, damit Screenreader sie vorlesen.
 */
export function BankSortierKopf({ sort = "datum", dir = "ab" }: Props) {
  const kopf = (feld: SortFeld, text: string, klasse = "sort-head") => {
    const aktiv = sort === feld;
    const naechste: SortRichtung = aktiv && dir === "ab" ? "auf" : "ab";
    const richtungText = naechste === "ab" ? "absteigend" : "aufsteigend";
    return (
      <Link
        to="/bank"
        search={(prev) => ({ ...prev, sort: feld, dir: naechste })}
        className={aktiv ? `${klasse} aktiv` : klasse}
        aria-label={`${text} ${richtungText} sortieren${aktiv ? `, zurzeit ${dir === "ab" ? "absteigend" : "aufsteigend"} sortiert` : ""}`}
      >
        {text}
        {aktiv ? (dir === "ab" ? " \u2193" : " \u2191") : ""}
      </Link>
    );
  };

  return (
    <div className="table-row head tx-cols" style={{ padding: "0 20px" }}>
      {kopf("datum", "Datum")}
      {kopf("gegenpartei", "Gegenpartei · Verwendungszweck")}
      {kopf("betrag", "Betrag", "sort-head num")}
      {kopf("status", "Status")}
    </div>
  );
}
