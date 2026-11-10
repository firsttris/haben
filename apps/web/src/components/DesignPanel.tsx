import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type ReactNode } from "react";
import {
  ACCENT_PATTERN,
  contrastOnWhite,
  DEFAULT_DESIGN,
  LETTERHEAD_FONTS,
  type LetterheadFont,
  MIN_TEXT_CONTRAST,
  type LetterheadDesign,
  type LetterheadDesignInput,
  type LogoPosition,
  type LogoSize,
} from "@haben/core";
import { useAction } from "../lib/use-action.ts";
import { useLoadedState } from "../lib/use-loaded-state.ts";
import { saveLetterheadDesign } from "../server/functions/logo.ts";
import { LogoUpload } from "./LogoUpload.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

/** Ungespeicherte Änderungen an der Gestaltung: Die Vorschau zeigt sie sofort, gespeichert wird erst auf Zuruf */
export function useDesignDraft(initial: LetterheadDesign = DEFAULT_DESIGN) {
  const [saved, setSaved] = useLoadedState(initial);
  const [changes, setChanges] = useState<LetterheadDesignInput>({});
  const design = { ...saved, ...changes };
  return {
    design,
    changes,
    dirty: (Object.keys(changes) as (keyof LetterheadDesignInput)[]).some((key) => changes[key] !== saved[key]),
    set: (input: LetterheadDesignInput) => setChanges((current) => ({ ...current, ...input })),
    discard: () => setChanges({}),
    /** Nach dem Speichern: Der Editor lädt nicht neu, damit getippte Eingaben im Formular bleiben. Was sich seit dem Klick geändert hat, bleibt ungespeichert stehen */
    commit: (sent: LetterheadDesignInput) => {
      setSaved((current) => ({ ...current, ...sent }));
      setChanges(
        (current) =>
          Object.fromEntries(Object.entries(current).filter(([key, value]) => value !== sent[key as keyof LetterheadDesignInput])) as LetterheadDesignInput,
      );
    },
  };
}

export type DesignDraft = ReturnType<typeof useDesignDraft>;

const LOGO_SIZE_OPTIONS: { value: LogoSize; label: string; name: string }[] = [
  { value: "s", label: "S", name: "Klein" },
  { value: "m", label: "M", name: "Mittel" },
  { value: "l", label: "L", name: "Groß" },
];

const LOGO_POSITION_OPTIONS: { value: LogoPosition; label: string; name: string }[] = [
  { value: "links", label: "Links", name: "Links" },
  { value: "rechts", label: "Rechts", name: "Rechts" },
];

const SWITCHES = [
  { key: "foldMarks", label: "Falz- und Lochmarken" },
  { key: "giroCode", label: "GiroCode" },
  { key: "customerNumber", label: "Kundennummer" },
  { key: "vatColumn", label: "Spalte USt je Position" },
] as const;

const SWATCHES = [
  { hex: "#1F6F5C", name: "Grün" },
  { hex: "#1D4E89", name: "Blau" },
  { hex: "#6B3FA0", name: "Violett" },
  { hex: "#9B1C1C", name: "Rot" },
  { hex: "#B45309", name: "Orange" },
  { hex: "#3F4A44", name: "Grau" },
];

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; name: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="btn btn-sm"
          title={option.name}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Logo und Schalter; gleich im Panel der Vorschau und in den Einstellungen */
export function DesignOptionFields({
  design,
  onChange,
  vatRates = 0,
  logoUpload,
}: {
  design: LetterheadDesign;
  onChange: (input: LetterheadDesignInput) => void;
  /** Steuersätze des geöffneten Belegs; in den Einstellungen gibt es keinen */
  vatRates?: number;
  logoUpload: ReactNode;
}) {
  const fontHeading = useId();
  return (
    <>
      <section>
        <h3 id={fontHeading}>Schrift</h3>
        <div className="field">
          <select aria-labelledby={fontHeading} value={design.font} onChange={(event) => onChange({ font: event.target.value as LetterheadFont })}>
            {(Object.keys(LETTERHEAD_FONTS) as LetterheadFont[]).map((font) => (
              <option key={font} value={font}>
                {LETTERHEAD_FONTS[font].name}
              </option>
            ))}
          </select>
        </div>
      </section>
      <section>
        <h3>Logo</h3>
        {logoUpload}
        <div className="design-logo-row">
          <Segmented label="Größe des Logos" options={LOGO_SIZE_OPTIONS} value={design.logoSize} onChange={(logoSize) => onChange({ logoSize })} />
          <Segmented
            label="Seite des Logos"
            options={LOGO_POSITION_OPTIONS}
            value={design.logoPosition}
            onChange={(logoPosition) => onChange({ logoPosition })}
          />
        </div>
      </section>
      <section>
        <h3>Auf dem Blatt</h3>
        {SWITCHES.map(({ key, label }) => (
          <label key={key} className="checkbox">
            <input type="checkbox" checked={design[key]} onChange={(event) => onChange({ [key]: event.target.checked })} />
            {label}
          </label>
        ))}
        {!design.vatColumn && vatRates > 1 && (
          <div className="banner banner-info" role="status">
            Dieser Beleg hat mehrere Steuersätze, deshalb bleibt die Spalte USt stehen.
          </div>
        )}
        <p className="small muted">Bei mehreren Steuersätzen bleibt die Spalte USt stehen. Pflichtangaben und Summen lassen sich hier nicht ausblenden.</p>
      </section>
    </>
  );
}

function AccentField({ accent, onChange }: { accent: string; onChange: (accent: string) => void }) {
  const weak = ACCENT_PATTERN.test(accent) && contrastOnWhite(accent) < MIN_TEXT_CONTRAST;
  const custom = !SWATCHES.some((swatch) => swatch.hex === accent.toUpperCase());
  return (
    <section>
      <h3>Farbe</h3>
      <div className="color-swatches">
        <label className="color-swatch color-swatch-custom" title="Eigene Farbe wählen" data-active={custom || undefined}>
          <span>{custom && <span className="color-swatch-dot" style={{ background: accent }} />}</span>
          <input type="color" aria-label="Eigene Farbe wählen" value={accent.toLowerCase()} onChange={(event) => onChange(event.target.value.toUpperCase())} />
        </label>
        {SWATCHES.map((swatch) => (
          <button
            key={swatch.hex}
            type="button"
            className="color-swatch"
            aria-label={swatch.name}
            aria-pressed={accent.toUpperCase() === swatch.hex}
            onClick={() => onChange(swatch.hex)}
          >
            <span style={{ background: swatch.hex }} />
          </button>
        ))}
      </div>
      {custom && (
        <p className="small muted">
          Eigene Farbe <span className="mono">{accent}</span>
        </p>
      )}
      {weak && (
        <div className="banner banner-info" role="status">
          Diese Farbe ist auf weißem Papier schwer zu lesen.
        </div>
      )}
    </section>
  );
}

/** Spalte neben dem Blatt: Gestaltung ändern und im Blatt sehen, ohne das Formular zu verlassen */
export function DesignPanel({
  draft,
  vatRates,
  logo,
  onLogoChanged,
}: {
  draft: DesignDraft;
  vatRates: number;
  logo: string | null;
  onLogoChanged: (sha256: string | null) => void;
}) {
  const save = useServerFn(saveLetterheadDesign);
  const { busy, notice, run } = useAction();

  const onSave = () =>
    run(async () => {
      const sent = draft.changes;
      await save({ data: sent });
      draft.commit(sent);
    }, "Gespeichert. Gilt für alles, was ab jetzt erzeugt wird.");

  return (
    <aside className="design-panel" aria-label="Gestaltung">
      <div className="design-panel-body">
        <AccentField accent={draft.design.accent} onChange={(accent) => draft.set({ accent })} />
        <DesignOptionFields
          design={draft.design}
          onChange={draft.set}
          vatRates={vatRates}
          logoUpload={<LogoUpload sha256={logo} onChanged={onLogoChanged} />}
        />
      </div>
      <div className="design-panel-foot">
        <p className="small muted">
          Standardgestaltung: gilt für alles, was ab jetzt erzeugt wird, auch für offene Entwürfe. Festgeschriebene PDFs bleiben unverändert.
          {draft.dirty && " Beim Schließen der Vorschau gehen ungespeicherte Änderungen verloren."}
        </p>
        <NoticeBanner notice={notice} />
        <div className="actions">
          <button type="button" className="btn" disabled={busy || !draft.dirty} onClick={draft.discard}>
            Verwerfen
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !draft.dirty} onClick={() => void onSave()}>
            Für alle Belege speichern
          </button>
        </div>
      </div>
    </aside>
  );
}
