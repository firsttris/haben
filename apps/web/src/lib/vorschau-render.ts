/** Wie oft die echte Vorschau neu gesetzt wird: mindestens 0,5 s Pause, bei langsamen Rechnern das Doppelte der letzten Renderzeit */
export const RENDER_MIN_DELAY_MS = 500;
/** Länger als das rendert nur noch auf Knopfdruck, sonst käme das Tippen nicht hinterher */
export const RENDER_MANUAL_ABOVE_MS = 2000;

export const renderDelay = (lastMs: number): number => Math.max(RENDER_MIN_DELAY_MS, lastMs * 2);

export const rendersOnDemand = (lastMs: number): boolean => lastMs > RENDER_MANUAL_ABOVE_MS;

/**
 * Nach einem Lauf: Passt das Blatt zum Formular, ist es fertig. Sonst bleibt bei langsamen Läufen der Knopf, bei
 * schnellen wird gleich neu gesetzt; die Entprellung der Eingabe hatte noch mit der alten Renderzeit gerechnet.
 */
export function afterRender(renderedKey: string, currentKey: string, ms: number): "fertig" | "knopf" | "neu" {
  if (renderedKey === currentKey) return "fertig";
  return rendersOnDemand(ms) ? "knopf" : "neu";
}
