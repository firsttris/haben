import { euerYear, ustYear } from "./annual.ts";

/** Nur die Zahlen einer gespeicherten Erklärung (figures enthält auch Listen und Kennzeichen) */
export const zahlen = (werte: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(werte).filter((e): e is [string, number] => typeof e[1] === "number"));

/**
 * Was Haben heute für eine Erklärung rechnet, als Zahlen je Feld wie in annual_submissions.figures: Umsatzsteuererklärung
 * mit Steuer und Abschlusszahlung, Anlage EÜR mit Gewinn. Ein Vermerk hält das fest wie eine Übermittlung (vermerk.ts), die
 * Prüfung gegen das Journal vergleicht damit (erklaert-pruefen.ts).
 */
export async function gerechneteZahlen(form: "ust" | "euer", year: number): Promise<Record<string, number>> {
  if (form === "ust") {
    const u = await ustYear(year);
    return { ...zahlen(u.figures as unknown as Record<string, unknown>), steuer: u.steuer, abschluss: u.abschluss };
  }
  const e = await euerYear(year);
  return { ...zahlen(e.figures as unknown as Record<string, unknown>), gewinn: e.gewinn };
}
