import { alternativeMain, formatEuro, type QuoteLineKind } from "@haben/core";

interface ChoiceLine {
  position: number;
  description: string;
  kind: QuoteLineKind | null;
  net: number;
}

/**
 * Auswahl des Kunden bei optionalen und alternativen Positionen (help.lexware.de, Artikel 547989): optionale per Haken,
 * je Hauptposition genau eine Variante per Optionsfeld. Rechnung, Abschläge und Auftragsbestätigung übernehmen nur die
 * gewählten. Ist eine Rechnung zum Angebot festgeschrieben, bleibt die Auswahl, wie sie ist.
 */
export function QuoteChoices({
  lines,
  chosen,
  onChange,
  locked,
}: {
  lines: ChoiceLine[];
  chosen: number[];
  onChange: (chosen: number[]) => void;
  locked: boolean;
}) {
  const optional = lines.filter((l) => l.kind === "optional");
  const mains = lines.filter((l) => l.kind === null && lines.some((a) => a.kind === "alternative" && alternativeMain(lines, a.position) === l.position));
  const alternativesOf = (main: number) => lines.filter((l) => l.kind === "alternative" && alternativeMain(lines, l.position) === main);
  const toggle = (position: number, on: boolean) => onChange(on ? [...chosen, position] : chosen.filter((p) => p !== position));
  const pick = (main: number, position: number) => {
    const group = alternativesOf(main).map((a) => a.position);
    onChange([...chosen.filter((p) => !group.includes(p)), ...(position === main ? [] : [position])]);
  };

  return (
    <section className="card" aria-labelledby="choices-heading">
      <h2 id="choices-heading">Auswahl des Kunden</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {locked
          ? "Zum Angebot ist eine Rechnung festgeschrieben; die Auswahl ist fest."
          : "Welche optionalen Positionen und welche Varianten der Kunde nimmt. Rechnung, Abschläge, Zahlungsplan und Auftragsbestätigung übernehmen nur die gewählten."}
      </p>
      {mains.map((main) => {
        const alternatives = alternativesOf(main.position);
        const current = alternatives.find((a) => chosen.includes(a.position))?.position ?? main.position;
        return (
          <fieldset key={main.position} className="choice-group">
            <legend>Variante zu Position {main.position}</legend>
            {[main, ...alternatives].map((l) => (
              <label key={l.position} className="checkbox">
                <input
                  type="radio"
                  name={`variante-${main.position}`}
                  checked={current === l.position}
                  disabled={locked}
                  onChange={() => pick(main.position, l.position)}
                />
                <span>
                  Pos. {l.position} {l.description} · <span className="amount">{formatEuro(l.net)}</span> netto
                </span>
              </label>
            ))}
          </fieldset>
        );
      })}
      {optional.length > 0 && (
        <fieldset className="choice-group">
          <legend>Optionale Positionen</legend>
          {optional.map((l) => (
            <label key={l.position} className="checkbox">
              <input type="checkbox" checked={chosen.includes(l.position)} disabled={locked} onChange={(e) => toggle(l.position, e.target.checked)} />
              <span>
                Pos. {l.position} {l.description} · <span className="amount">{formatEuro(l.net)}</span> netto
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </section>
  );
}
