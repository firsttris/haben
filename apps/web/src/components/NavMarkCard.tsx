import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { ACCENT_PATTERN } from "@haben/core";
import { navMark } from "../lib/navigation.ts";
import { useAction } from "../lib/use-action.ts";
import { saveNavMarkSetting } from "../server/functions/company.ts";
import { Field } from "./Field.tsx";
import { NavMarkSymbol } from "./NavMarkSymbol.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

type Art = "standard" | "farbe" | "logo";

/** Vorschlag für die eigene Farbe, solange keine gewählt ist: kräftig und von allen Themes gut zu unterscheiden */
const FARBE_VORSCHLAG = "#1D4ED8";

/**
 * Zeichen der Firma in der Navigation (#504), getrennt von der Beleggestaltung: „H“ des Themes, „H“ in eigener Farbe
 * oder das Logo der Belege, Letzteres nur auf ausdrückliche Wahl
 */
export function NavMarkCard({ color, logo, logoSha256 }: { color: string | null; logo: boolean; logoSha256: string | null }) {
  const router = useRouter();
  const save = useServerFn(saveNavMarkSetting);
  const { busy, notice, run } = useAction();
  const [art, setArt] = useState<Art>(logo && logoSha256 ? "logo" : color ? "farbe" : "standard");
  const [farbe, setFarbe] = useState(color ?? FARBE_VORSCHLAG);
  const valid = art !== "farbe" || ACCENT_PATTERN.test(farbe);
  // Vorschau mit dem Logo aus der Beleggestaltung; /api/kennzeichen liefert es erst, wenn es gewählt ist
  const vorschau =
    art === "logo" && logoSha256
      ? { logo: `/api/logo?v=${logoSha256.slice(0, 16)}` }
      : navMark({ color: art === "farbe" && valid ? farbe : null, logo: false }, null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await save({ data: art === "farbe" ? { art, farbe } : { art } });
      if (art === "farbe") setFarbe(farbe.toUpperCase());
      await router.invalidate();
    }, "Zeichen gespeichert. Es gilt für alle Zugänge dieser Instanz.");
  }

  const option = (value: Art, text: string, extra?: { disabled?: boolean; describedBy?: string }) => (
    <label className="checkbox">
      <input
        type="radio"
        name="nav-mark"
        value={value}
        checked={art === value}
        onChange={() => setArt(value)}
        disabled={busy || extra?.disabled}
        aria-describedby={extra?.describedBy}
      />
      {text}
    </label>
  );

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="nav-mark-heading">
      <h2 id="nav-mark-heading">Zeichen in der Navigation</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Daran erkennst du die Firma in der Navigation, etwa wenn du mehrere Firmen als eigene Instanzen führst. Es gilt für alle Zugänge dieser Instanz und
        hängt nicht an der Beleggestaltung: Akzentfarbe, Logo und Layout der Belege bleiben, wie sie sind.
      </p>
      <div className="nav-mark-choice">
        <fieldset className="stack" style={{ gap: 4 }}>
          <legend className="small muted" style={{ marginBottom: 4 }}>
            Zeichen
          </legend>
          {option("standard", "„H“ in der Farbe des Themes")}
          {option("farbe", "„H“ in eigener Farbe")}
          {art === "farbe" && (
            <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", marginLeft: 35 }}>
              <Field label="Farbe wählen">
                {(control) => (
                  <input
                    {...control}
                    type="color"
                    value={valid ? farbe.toLowerCase() : FARBE_VORSCHLAG.toLowerCase()}
                    onChange={(e) => setFarbe(e.target.value.toUpperCase())}
                    disabled={busy}
                  />
                )}
              </Field>
              <Field label="Hex-Wert" hint="Form #RRGGBB">
                {(control) => (
                  <input
                    {...control}
                    className="mono"
                    value={farbe}
                    onChange={(e) => setFarbe(e.target.value.trim())}
                    pattern="#[0-9A-Fa-f]{6}"
                    maxLength={7}
                    required
                    disabled={busy}
                  />
                )}
              </Field>
            </div>
          )}
          <div className="checkbox-hinted">
            {option("logo", "Logo aus der Beleggestaltung", { disabled: !logoSha256, describedBy: "nav-mark-logo-hint" })}
            <span id="nav-mark-logo-hint" className="field-hint">
              {logoSha256
                ? "Steht in einem Quadrat: Am besten wirkt ein quadratisches Bildzeichen, breite Schriftzüge werden klein. Ändert sich mit dem Logo der Belege, fehlt es später, gilt wieder das „H“."
                : "Erst möglich, wenn unter Beleggestaltung ein Logo hochgeladen ist."}
            </span>
          </div>
        </fieldset>
        <div className="nav-mark-preview" aria-hidden="true">
          <NavMarkSymbol mark={vorschau} />
          Haben
        </div>
      </div>
      <div className="actions">
        <button type="submit" className="btn" disabled={busy || !valid}>
          Übernehmen
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}
