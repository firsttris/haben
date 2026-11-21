import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type EingebautesLayout, eingebautesLayout, LAYOUT_DOCUMENT_TYPES, type LetterheadDesign, optionenZurWahl } from "@haben/core";
import { useAction } from "../lib/use-action.ts";
import { saveLetterheadDesign } from "../server/functions/logo.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { Segmented } from "./Segmented.tsx";

/**
 * Optionen eines eingebauten Layouts (layout-katalog.ts), etwa wo der Fuß steht. Ein Wert, den eine frühere Option
 * ausschließt, ist ausgegraut; das Blatt setzt dann den ersten erlaubten, und der ist gedrückt.
 */
export function LayoutOptionFields({
  layoutId,
  design,
  onChange,
  disabled,
}: {
  layoutId: string;
  design: LetterheadDesign;
  /** Die Wahl für dieses Layout, aufgelöst; die anderer Layouts bleibt */
  onChange: (layoutOptions: LetterheadDesign["layoutOptions"]) => void;
  disabled?: boolean;
}) {
  const layout = eingebautesLayout(layoutId);
  if (!layout) return null;
  const gewaehlt = design.layoutOptions[layoutId] ?? {};
  const optionen = optionenZurWahl(layout, gewaehlt);
  return (
    <>
      {optionen.map((option) => (
        <fieldset key={option.id} className="field">
          <legend>{option.name}</legend>
          <Segmented
            label={`${option.name} (${layout.name})`}
            options={option.werte.map((wert) => ({ value: wert.id, label: wert.name, name: wert.name }))}
            value={option.wert}
            disabled={disabled}
            disabledValues={option.werte.filter((wert) => !wert.erlaubt).map((wert) => wert.id)}
            // Die Wahl, nicht das Aufgelöste: Ein gesperrter Wert bleibt gespeichert und gilt wieder, sobald die Sperre fällt
            onChange={(wert) => onChange({ ...design.layoutOptions, [layoutId]: { ...gewaehlt, [option.id]: wert } })}
          />
        </fieldset>
      ))}
    </>
  );
}

/** In den Einstellungen: je eingebautem Layout, das eine Belegart nutzt, einmal seine Optionen; gespeichert wird sofort */
export function LayoutOptionsSections({ design }: { design: LetterheadDesign }) {
  const router = useRouter();
  const save = useServerFn(saveLetterheadDesign);
  const { busy, notice, run } = useAction();
  const ids = new Set(LAYOUT_DOCUMENT_TYPES.map((type) => design.layouts[type]).flatMap((ref) => (ref.kind === "eingebaut" ? [ref.id] : [])));
  const layouts = [...ids]
    .map((id) => eingebautesLayout(id))
    .filter((layout): layout is EingebautesLayout => layout !== undefined && layout.optionen.length > 0);

  const onChange = (layoutOptions: LetterheadDesign["layoutOptions"]) =>
    run(async () => {
      await save({ data: { layoutOptions } });
      await router.invalidate();
    }, "Gespeichert. Gilt für alles, was ab jetzt erzeugt wird.");

  return (
    <>
      {layouts.map((layout) => (
        <section key={layout.id} aria-labelledby={`layout-optionen-${layout.id}`} className="layout-options">
          <h3 id={`layout-optionen-${layout.id}`}>{layout.name}</h3>
          <p className="small muted">Gilt für jede Belegart mit diesem Layout.</p>
          <LayoutOptionFields layoutId={layout.id} design={design} disabled={busy} onChange={(layoutOptions) => void onChange(layoutOptions)} />
        </section>
      ))}
      <NoticeBanner notice={notice} />
    </>
  );
}
