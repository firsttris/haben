import { formatEuro } from "@haben/core";
import type { kleinunternehmerStand } from "../server/modules/auswertungen/index.ts";

export function KleinunternehmerHinweise({ stand }: { stand: Awaited<ReturnType<typeof kleinunternehmerStand>> }) {
  const { aktuell, vorjahr, jahr, gruendungsjahr, naheAktuell, vorjahresgrenzeUeberschritten, jahresgrenze, vorjahresgrenze } = stand;
  const ungeklaert = aktuell.ungeklaert || vorjahr.ungeklaert;
  if (!naheAktuell && !vorjahresgrenzeUeberschritten && !ungeklaert) return null;
  return (
    <section className="banner banner-warn" aria-label="Umsatzgrenzen für Kleinunternehmer">
      <div>
        <strong>Umsatzgrenzen nach § 19 UStG</strong>
        <ul className="banner-list">
          {vorjahresgrenzeUeberschritten && (
            <li>
              {jahr - 1} laut Buchungen vereinnahmt: {formatEuro(vorjahr.netto)}. Lag dein Gesamtumsatz im Vorjahr über {formatEuro(vorjahresgrenze)}, entfällt
              die Kleinunternehmerregelung ab dem 1. Januar {jahr}.
            </li>
          )}
          {naheAktuell && (
            <li>
              {jahr} laut Buchungen vereinnahmt: {formatEuro(aktuell.netto)}.
            </li>
          )}
          {naheAktuell && (
            <li>
              {aktuell.netto > jahresgrenze
                ? `Der gebuchte Betrag liegt über der Grenze ${gruendungsjahr ? "im Gründungsjahr" : "für das laufende Jahr"} von ${formatEuro(jahresgrenze)}. Prüfe, ab welchem Umsatz die Befreiung entfällt.`
                : `Die Grenze ${gruendungsjahr ? "im Gründungsjahr" : "für das laufende Jahr"} liegt bei ${formatEuro(jahresgrenze)}. Die Befreiung entfällt ab dem Umsatz, der sie überschreitet.`}
            </li>
          )}
          {naheAktuell && !gruendungsjahr && (
            <li>
              Für die Kleinunternehmerregelung im Jahr {jahr + 1} darf dein Gesamtumsatz im Jahr {jahr} höchstens {formatEuro(vorjahresgrenze)} betragen. Laut
              Buchungen liegst du bereits darüber.
            </li>
          )}
          {ungeklaert && <li>Prüfe steuerfreie Erlöse und uneindeutige Importzahlungen separat, soweit sie auf deine Buchungen zutreffen.</li>}
          <li>Wenn du Anlagen verkauft hast, prüfe den Betrag. Als normale Rechnung erfasste Anlagenverkäufe können enthalten sein.</li>
        </ul>
      </div>
    </section>
  );
}
