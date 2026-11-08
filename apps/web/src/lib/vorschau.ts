/**
 * Vorschau der Belegeditoren (#357): als Überblendung über dem Formular oder neben ihm angeheftet. Die Wahl liegt je
 * Gerät im Browser (localStorage), nicht auf dem Server; ob Anheften geht, entscheidet die Breite des Editors.
 */
export type PreviewMode = "ueberblendung" | "angeheftet";

export const PREVIEW_MODE_KEY = "haben-vorschau";

/**
 * Mindestbreiten in px: Schmaler schneidet das Formular Felder ab (USt zeigt auf dem 14-Zoll-Laptop nur „1…“, #355),
 * schmaler ist die Vorschau nicht mehr lesbar. Dazu der Abstand zwischen den Spalten (`.preview-layout`).
 */
export const FORM_MIN_WIDTH = 640;
export const PREVIEW_MIN_WIDTH = 420;
export const PREVIEW_GAP = 16;
export const PIN_MIN_WIDTH = FORM_MIN_WIDTH + PREVIEW_MIN_WIDTH + PREVIEW_GAP;

/**
 * Ohne gespeicherte Wahl heftet die Vorschau erst an, wo das Formular daneben noch reichlich Platz hat: auf dem großen
 * Bildschirm (ab etwa 1720 px Fensterbreite). Auf dem Laptop ist das Formular sonst zu eng, dort zuerst die Überblendung.
 */
export const PIN_DEFAULT_WIDTH = 1400;

export function parsePreviewMode(value: string | null | undefined): PreviewMode | null {
  return value === "ueberblendung" || value === "angeheftet" ? value : null;
}

/**
 * Was der Editor bei dieser Breite zeigt: Anheften nur, wenn Formular und Vorschau ihre Mindestbreite haben; sonst
 * (Handy, schmales Fenster) nur die Überblendung, auch wenn das Gerät sonst angeheftet ist. Breite unbekannt (Server,
 * vor der ersten Messung): Überblendung, damit das Formular nicht erst schmal und dann breit gezeichnet wird.
 */
export function previewLayout(stored: PreviewMode | null, width: number | null): { canPin: boolean; pinned: boolean } {
  if (width === null || width < PIN_MIN_WIDTH) return { canPin: false, pinned: false };
  const mode = stored ?? (width >= PIN_DEFAULT_WIDTH ? "angeheftet" : "ueberblendung");
  return { canPin: true, pinned: mode === "angeheftet" };
}

/** Lesen und Schreiben scheitern still, etwa im privaten Fenster: Dann gilt die Vorgabe nach Breite */
export function readPreviewMode(storage: Pick<Storage, "getItem"> | undefined): PreviewMode | null {
  try {
    return parsePreviewMode(storage?.getItem(PREVIEW_MODE_KEY));
  } catch {
    return null;
  }
}

export function writePreviewMode(storage: Pick<Storage, "setItem"> | undefined, mode: PreviewMode): void {
  try {
    storage?.setItem(PREVIEW_MODE_KEY, mode);
  } catch {
    // Nur für dieses Mal: die Wahl gilt bis zum Neuladen
  }
}

/**
 * Ob die Überblendung beim Schließen den Fokus auf ihren Auslöser zurückholt. Nach Escape ist der Dialog sofort zu, das
 * Ereignis „close“ kommt erst danach als eigener Task (HTML Standard, „close the dialog“); wer in dieser Lücke schon ins
 * Formular geklickt hat, behält den Fokus. Zurück also nur, wenn er noch in der Leiste steht oder nirgends (body).
 */
export function returnsFocusOnClose<T>(active: T | null, body: T, overlayContains: (element: T) => boolean): boolean {
  return active === null || active === body || overlayContains(active);
}
