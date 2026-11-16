import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { BEREICHE, type BereichId } from "../lib/bereiche.ts";
import { useAction } from "../lib/use-action.ts";
import { saveBereicheSetting } from "../server/functions/einrichtung.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { Status } from "./Status.tsx";

/**
 * Einstellungen › Bereiche (#266): je Bereich ein Schalter. Ein Klick speichert sofort, die Navigation zeigt es gleich.
 * Ausgeblendet heißt nur ohne Menüpunkt; Daten, Auswertungen und Links bleiben.
 */
export function BereicheCard({ ausgeblendet }: { ausgeblendet: readonly string[] }) {
  const router = useRouter();
  const save = useServerFn(saveBereicheSetting);
  const { busy, notice, run } = useAction();
  // Der Haken folgt dem Klick sofort; schlägt das Speichern fehl, gilt wieder der gespeicherte Stand
  const [lokal, setLokal] = useState<readonly string[]>(ausgeblendet);
  useEffect(() => setLokal(ausgeblendet), [ausgeblendet]);

  function umschalten(id: BereichId, sichtbar: boolean) {
    const naechste = BEREICHE.map((b) => b.id).filter((b) => (b === id ? !sichtbar : lokal.includes(b)));
    const { label } = BEREICHE.find((b) => b.id === id)!;
    setLokal(naechste);
    void run(
      async () => {
        await save({ data: { ausgeblendet: naechste } });
        await router.invalidate();
      },
      sichtbar ? `${label} steht wieder im Menü.` : `${label} ist ausgeblendet.`,
    ).then((ok) => {
      if (!ok) setLokal(ausgeblendet);
    });
  }

  return (
    <section className="card stack" aria-labelledby="bereiche-heading">
      <h2 id="bereiche-heading">Bereiche im Menü</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Was du nicht brauchst, blendest du aus. Es verschwindet nur aus Menü und Schnellsuche; Daten, Auswertungen und Links bleiben. Rechnungen, Belege, Bank,
        Umsatzsteuer und Jahreserklärung stehen immer im Menü.
      </p>
      <ul className="bereiche-liste">
        {BEREICHE.map((bereich) => {
          const sichtbar = !lokal.includes(bereich.id);
          const hint = `bereich-${bereich.id}-hint`;
          return (
            <li key={bereich.id} className="checkbox-hinted">
              <label className="checkbox">
                <input type="checkbox" checked={sichtbar} disabled={busy} aria-describedby={hint} onChange={(e) => umschalten(bereich.id, e.target.checked)} />
                <span>{bereich.label}</span>
              </label>
              {/* Der Status steht in der Beschreibung, nicht im Label: Sonst hieße das Kästchen je nach Zustand anders */}
              <span id={hint} className="field-hint">
                {!sichtbar && (
                  <>
                    <Status tone="neutral" inline>
                      Ausgeblendet
                    </Status>{" "}
                    ·{" "}
                  </>
                )}
                Im Menü: {bereich.menue}
              </span>
            </li>
          );
        })}
      </ul>
      <NoticeBanner notice={notice} />
      <div className="actions">
        <Link to="/einrichtung" className="btn">
          Fragen erneut durchgehen
        </Link>
      </div>
    </section>
  );
}
