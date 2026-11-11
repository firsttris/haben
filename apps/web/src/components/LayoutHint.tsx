import type { getLayouts } from "../server/functions/layouts.ts";

/** Hinweise je Einstellung der Gestaltung, die ein zugeordnetes eigenes Layout nicht verwendet (#113) */
export type LayoutHints = Awaited<ReturnType<typeof getLayouts>>["hints"];
export type LayoutHintEntry = NonNullable<LayoutHints[keyof LayoutHints]>;

/** Hinweis zu einer Einstellung; auch zu Schlüsseln ohne Feld im Layout (etwa customerNumber), dann keiner */
export const layoutHint = (hints: LayoutHints | undefined, option: string): LayoutHintEntry | undefined =>
  (hints as Partial<Record<string, LayoutHintEntry>> | undefined)?.[option];

/** Die id des Hinweises für aria-describedby; einmal je Seite, denn nur die Einstellungen zeigen Hinweise */
export const layoutHintId = (option: string, hint: LayoutHintEntry | undefined): string | undefined => (hint ? `layout-hint-${option}` : undefined);

/** Sichtbarer Hinweis, warum eine Einstellung aus ist oder nicht auf alle Belege wirkt */
export function LayoutHintText({ option, hint }: { option: string; hint: LayoutHintEntry | undefined }) {
  if (!hint) return null;
  return (
    <span id={layoutHintId(option, hint)} className="field-hint">
      {hint.text}
    </span>
  );
}
