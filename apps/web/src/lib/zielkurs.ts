/**
 * Zielkurs auf ein offenes Flyout („safe triangle“, Ben Kamens 2013, jQuery-menu-aim): Wer vom Symbol schräg zum
 * Flyout zieht, streift dabei oft das Symbol darunter. Solange der Zeiger im Dreieck aus seiner vorigen Lage und der
 * linken Kante des Flyouts bleibt und sich bewegt, öffnet das gestreifte Symbol nichts. Steht er still oder verlässt
 * er das Dreieck, gilt das Symbol unter ihm. Nur für die Maus, nur auf dem Weg ins Flyout.
 */

export interface Punkt {
  x: number;
  y: number;
}

/** Ob p im Dreieck a, b, c liegt (Rand eingeschlossen), über die Vorzeichen der Kreuzprodukte */
export function imDreieck(p: Punkt, a: Punkt, b: Punkt, c: Punkt): boolean {
  const kreuz = (u: Punkt, v: Punkt, w: Punkt) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  const d1 = kreuz(a, b, p);
  const d2 = kreuz(b, c, p);
  const d3 = kreuz(c, a, p);
  const negativ = d1 < 0 || d2 < 0 || d3 < 0;
  const positiv = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negativ && positiv);
}

/** Linke Kante des Flyouts, etwas über und unter das Panel hinaus, damit auch die oberste und unterste Zeile zählen */
const UEBERSTAND = 8;

/**
 * Hält der Zeiger Kurs auf das Flyout? `vorher` ist die Lage vor der letzten Bewegung, `jetzt` die aktuelle, `panel`
 * das Rechteck des offenen Flyouts. Ohne Bewegung (gleiche Lage) kein Kurs: Wer anhält, will das Symbol darunter.
 */
export function haeltKurs(vorher: Punkt, jetzt: Punkt, panel: { left: number; top: number; bottom: number }): boolean {
  if (vorher.x === jetzt.x && vorher.y === jetzt.y) return false;
  if (jetzt.x <= vorher.x) return false;
  return imDreieck(jetzt, vorher, { x: panel.left, y: panel.top - UEBERSTAND }, { x: panel.left, y: panel.bottom + UEBERSTAND });
}
