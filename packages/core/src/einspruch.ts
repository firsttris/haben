import { addDays, naechsterWerktag } from "./holidays.ts";
import type { Bundesland } from "./steuernummer.ts";

/** Datum aus ELSTER-Metadaten: JJJJ-MM-TT, TT.MM.JJJJ oder JJJJMMTT; sonst null */
export function parseBescheiddatum(value: string): string | null {
  const v = value.trim();
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) iso = v.slice(0, 10);
  else if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) iso = `${v.slice(6, 10)}-${v.slice(3, 5)}-${v.slice(0, 2)}`;
  else if (/^\d{8}$/.test(v)) iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** Ein Monat später; gibt es den Tag nicht, das Monatsende (§ 188 Abs. 3 BGB) */
function addMonth(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export interface Einspruchsfrist {
  /** Tag, an dem der Bescheid als bekannt gegeben gilt */
  bekanntgabe: string;
  /** Letzter Tag für den Einspruch */
  fristende: string;
}

/**
 * Einspruchsfrist eines Steuerbescheids (§ 355 AO): ein Monat ab Bekanntgabe. Die Bekanntgabe gilt
 * am vierten Tag nach dem Bescheiddatum, bis 2024 am dritten (§ 122 Abs. 2, § 122a Abs. 4 AO). Fällt
 * die Bekanntgabe oder das Fristende auf einen Samstag, Sonntag oder Feiertag, gilt der nächste
 * Werktag (§ 108 Abs. 3 AO).
 */
export function einspruchsfrist(bescheiddatum: string, bundesland: Bundesland | null): Einspruchsfrist {
  const tage = bescheiddatum >= "2025-01-01" ? 4 : 3;
  const bekanntgabe = naechsterWerktag(addDays(bescheiddatum, tage), bundesland);
  return { bekanntgabe, fristende: naechsterWerktag(addMonth(bekanntgabe), bundesland) };
}
