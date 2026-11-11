import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { ACCENT_PATTERN, contrastOnWhite, DEFAULT_ACCENT, MIN_TEXT_CONTRAST } from "@haben/core";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { saveAccent } from "../server/functions/logo.ts";
import { Field } from "./Field.tsx";
import { LayoutHintText, layoutHintId, type LayoutHintEntry } from "./LayoutHint.tsx";

/** Akzentfarbe von Rechnungen, Angeboten und Mahnungen, etwa passend zum Logo */
export function AccentColorCard({ color, hint }: { color: string; hint?: LayoutHintEntry | undefined }) {
  const router = useRouter();
  const save = useServerFn(saveAccent);
  const { busy, notice, run } = useAction();
  const [value, setValue] = useState(color);
  const valid = ACCENT_PATTERN.test(value);
  const weak = valid && contrastOnWhite(value) < MIN_TEXT_CONTRAST;
  // Kein zugeordnetes Layout zeigt die Farbe: nicht änderbar, der Hinweis sagt warum
  const off = busy || hint?.aus === true;
  const hintId = layoutHintId("accent", hint);

  const store = (next: string) =>
    run(async () => {
      await save({ data: { color: next } });
      setValue(next.toUpperCase());
      await router.invalidate();
    }, "Akzentfarbe gespeichert. Sie gilt für alle Rechnungen, Angebote und Mahnungen, die ab jetzt festgeschrieben werden.");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void store(value);
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="accent-heading">
      <h2 id="accent-heading">Akzentfarbe</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Färbt Spaltenköpfe und Linien auf Rechnungen, Angeboten, Auftragsbestätigungen, Lieferscheinen und Mahnungen, etwa passend zum Logo; Text,
        Beschriftungen und Fußzeile bekommen dazu passende Grautöne. Schon festgeschriebene Belege behalten ihr PDF.
      </p>
      <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
        <Field label="Farbe wählen" describedBy={hintId}>
          {(control) => (
            <input
              {...control}
              type="color"
              value={valid ? value.toLowerCase() : DEFAULT_ACCENT.toLowerCase()}
              onChange={(e) => setValue(e.target.value.toUpperCase())}
              disabled={off}
            />
          )}
        </Field>
        <Field label="Hex-Wert" describedBy={hintId ? `accent-hint ${hintId}` : "accent-hint"}>
          {(control) => (
            <input
              {...control}
              className="mono"
              value={value}
              onChange={(e) => setValue(e.target.value.trim())}
              pattern="#[0-9A-Fa-f]{6}"
              maxLength={7}
              required
              disabled={off}
            />
          )}
        </Field>
        <span
          aria-hidden="true"
          style={{ borderBottom: `2px solid ${valid ? value : "transparent"}`, color: valid ? value : undefined, paddingBottom: 2 }}
          className="small"
        >
          Pos. · Beschreibung · Netto
        </span>
      </div>
      <p id="accent-hint" className="small muted" style={{ margin: 0 }}>
        Form #RRGGBB, Standard {DEFAULT_ACCENT}.
      </p>
      <LayoutHintText option="accent" hint={hint} />
      {weak && (
        <div className="banner banner-info" role="status">
          Diese Farbe ist auf weißem Papier schwer zu lesen (Kontrast {contrastOnWhite(value).toFixed(1).replace(".", ",")} : 1, empfohlen mindestens 4,5 : 1).
          Eine dunklere Variante des Logo-Farbtons liest sich besser.
        </div>
      )}
      <div className="actions" style={{ flexWrap: "wrap" }}>
        <button type="submit" className="btn" disabled={off || !valid}>
          Übernehmen
        </button>
        {color !== DEFAULT_ACCENT && (
          <button type="button" className="btn" disabled={off} onClick={() => void store(DEFAULT_ACCENT)}>
            Auf Standard zurücksetzen
          </button>
        )}
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}
