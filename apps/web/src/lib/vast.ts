import { formatEuro } from "@haben/core";
import { formatDate } from "./format.ts";

/** Wert lesbar: Beträge als Euro, JJJJMMTT als Datum, sonst wie geliefert */
export function formatWert(pfad: string[], wert: string): string {
  const name = pfad.at(-1) ?? "";
  // Beträge kommen mit Dezimalpunkt; Schlüssel wie Beitragsart 01 bleiben, wie sie sind
  if (/betrag|summe|lohn|steuer|beitr/i.test(name) && !/art$/i.test(name) && /^-?\d+\.\d{2}$/.test(wert)) {
    return formatEuro(Math.round(Number(wert) * 100));
  }
  if (/^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(wert) && /dat|beginn|ende/i.test(name)) {
    return formatDate(`${wert.slice(0, 4)}-${wert.slice(4, 6)}-${wert.slice(6, 8)}`);
  }
  // Zeitstempel ohne Uhrzeit: 01.03.2026 00:00:00 → 01.03.2026
  const mitMitternacht = /^(\d{2}\.\d{2}\.\d{4}) 00:00:00$/.exec(wert);
  if (mitMitternacht) return mitMitternacht[1]!;
  return wert;
}
