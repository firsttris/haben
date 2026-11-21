import { useState } from "react";
import { EINGEBAUTE_LAYOUTS, type EingebautesLayout, layoutOptionen, type LetterheadDesign } from "@haben/core";
import { LayoutOptionFields } from "./LayoutOptionFields.tsx";

const DOWNLOAD = "/api/belegvorlagen";
const ART_LABEL = { beleg: "Beleg", mahnung: "Mahnung" } as const;

/** Adresse des Downloads: Layout, Art und je Option der aufgelöste Wert */
export function downloadHref(layout: EingebautesLayout, gewaehlt: Readonly<Record<string, string>>, art: "beleg" | "mahnung"): string {
  const params = new URLSearchParams({ datei: "eingebaut", layout: layout.id, art, ...layoutOptionen(layout, gewaehlt) });
  return `${DOWNLOAD}?${params}`;
}

/**
 * Jedes eingebaute Layout in einer Variante als Grundlage für ein eigenes (#113). Die Auswahl beginnt bei der Wahl aus der
 * Gestaltung und ändert sie nicht; gesperrte Werte sind ausgegraut wie dort.
 */
export function EingebauteLayouts({ design }: { design: LetterheadDesign }) {
  const [wahl, setWahl] = useState<LetterheadDesign["layoutOptions"]>(design.layoutOptions);
  const auswahl = { ...design, layoutOptions: wahl };
  return (
    <section aria-labelledby="eingebaute-layouts-heading">
      <h3 id="eingebaute-layouts-heading">Eingebaute Layouts</h3>
      <p className="small muted" style={{ margin: "0 0 8px" }}>
        Als Grundlage für ein eigenes Layout, in der gewählten Variante. Die Auswahl hier ändert die Gestaltung nicht.
      </p>
      <ul className="own-layouts">
        {EINGEBAUTE_LAYOUTS.map((layout) => (
          <li key={layout.id} className="builtin-layout">
            <div className="own-layout-name">
              <strong>{layout.name}</strong>
              <span className="small muted">{layout.beschreibung}</span>
            </div>
            <div className="actions">
              {(["beleg", "mahnung"] as const).map((art) => (
                <a
                  key={art}
                  className="btn btn-sm"
                  href={downloadHref(layout, wahl[layout.id] ?? {}, art)}
                  download
                  aria-label={`${layout.name} für ${art === "beleg" ? "Belege" : "Mahnungen"} herunterladen`}
                >
                  {ART_LABEL[art]} herunterladen
                </a>
              ))}
            </div>
            {layout.optionen.length > 0 && (
              <div className="builtin-layout-options">
                <LayoutOptionFields layoutId={layout.id} design={auswahl} onChange={setWahl} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
