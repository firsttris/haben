import type { BwaBericht } from "../server/modules/auswertungen/index.ts";
import { anteilText, zeitraumText } from "./BwaTabelle.tsx";

/*
 * Kennzahlen der BWA (#1635) über der Tabelle: Wert im Zeitraum, mit Vergleich darunter klein der Wert dort, dann in einer
 * Zeile, was durch was geteilt ist. Formeln und Texte stehen im Kern (bwa-kennzahlen.ts).
 */

export function BwaKennzahlen({ bericht }: { bericht: BwaBericht }) {
  const { zeitraum, vergleich } = bericht.kennzahlen;
  // Mit „Aufschlag“ fünf Karten: `.grid-5`, damit sie am Desktop in einer Reihe stehen (DESIGN.md, Karten)
  return (
    <section className={`${zeitraum.length > 4 ? "grid-5" : "grid-4"} bwa-kennzahlen`} aria-label="Kennzahlen">
      {zeitraum.map((k) => {
        const vgl = vergleich?.find((v) => v.key === k.key);
        return (
          <div className="card" key={k.key}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value">{anteilText(k.wert)}</div>
            {bericht.vergleich && (
              <div className="small muted">
                {zeitraumText(bericht.vergleich, true)}: {anteilText(vgl?.wert ?? null)}
              </div>
            )}
            <div className="small muted">{k.erklaerung}</div>
          </div>
        );
      })}
    </section>
  );
}
