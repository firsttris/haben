import { formatEuro, kategorieFehler, kategorieVorschlag, type Kontenrahmen } from "@haben/core";
import type { KategorieWahl } from "./KategorieFelder.tsx";

/**
 * Zeigt vor dem Buchen, was Direkt buchen auf eine Kategorie bucht (#1440, Stufe 1): Konto mit Nummer, Betrag und Steuer.
 * Nur Anzeige; gebucht wird weiter mit dem Knopf darunter.
 */
export function BuchungsVorschlag({ wahl, amount, kontenrahmen }: { wahl: KategorieWahl; amount: number | null; kontenrahmen: Kontenrahmen }) {
  if (amount === null || amount === 0) return null;
  // Eine Angabe, die der Server ablehnen würde (etwa 0 % ohne Kleinunternehmer), zeigt keine Zeilen; das Feld nennt den Fehler
  if (kategorieFehler(wahl, wahl.kategorie === "erloese" && wahl.steuersatz === 0)) return null;
  const zeilen = kategorieVorschlag(wahl, amount, kontenrahmen);
  const zelle = {
    padding: "6px 8px 6px 0",
    borderBottom: "1px solid var(--line-soft)",
    textAlign: "left",
    verticalAlign: "baseline",
    fontWeight: 400,
  } as const;
  const zahl = { ...zelle, paddingRight: 0, textAlign: "right", whiteSpace: "nowrap" } as const;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="section-label">Wird gebucht</div>
      <table aria-label="Buchungsvorschlag" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead className="small muted">
          <tr>
            <th scope="col" style={zelle}>
              Konto
            </th>
            <th scope="col" style={zelle}>
              Steuer
            </th>
            <th scope="col" style={zahl}>
              Betrag
            </th>
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => (
            <tr key={z.konto}>
              <td style={zelle}>
                <span className="mono">{z.konto}</span>
                {z.kontoName && ` · ${z.kontoName}`}
              </td>
              <td style={zelle}>{z.steuer}</td>
              <td className="mono" style={zahl}>
                {formatEuro(z.betrag)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
