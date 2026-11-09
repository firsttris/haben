/**
 * `<label className="field">` ist so breit wie sein Feld, ein Klick auf die leere Fläche neben dem Feldnamen würde das
 * Feld fokussieren. CSS reicht dagegen nicht: Der Feldname ist meist ein bloßer Textknoten, dem sich kein
 * `pointer-events` geben lässt. Deshalb entscheidet ein Listener am Dokument für alle Felder, ohne Umbau des Markups.
 */

const BEDIENELEMENT = "a, button, input, select, textarea, summary";

function liegtAufText(wurzel: Element, x: number, y: number): boolean {
  const texte = document.createTreeWalker(wurzel, NodeFilter.SHOW_TEXT);
  const bereich = document.createRange();
  for (let text = texte.nextNode(); text; text = texte.nextNode()) {
    bereich.selectNodeContents(text);
    // Je Zeile ein Rechteck: Das Rechteck des ganzen Textes enthielte bei Umbruch auch die leere Fläche
    for (const zeile of bereich.getClientRects()) {
      if (x >= zeile.left && x <= zeile.right && y >= zeile.top && y <= zeile.bottom) return true;
    }
  }
  return false;
}

/** detail 0 sind Klicks ohne Zeiger (Tastatur, Screenreader, `element.click()`), die keinen Punkt auf dem Bildschirm treffen */
export function leereFlaecheIgnorieren(event: MouseEvent): void {
  if (event.detail === 0 || !(event.target instanceof Element) || event.target.closest(BEDIENELEMENT)) return;
  const feld = event.target.closest("label.field");
  if (feld && !liegtAufText(feld, event.clientX, event.clientY)) event.preventDefault();
}
