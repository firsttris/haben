import { gesamtumsatzForYear } from "../auswertungen/index.ts";
import { kleinunternehmerForMonth } from "../stammdaten/index.ts";

/**
 * EÜR 2025, Zeile 13: nicht steuerbare Umsätze und Abzüge nach § 19 Abs. 2 nur nachrichtlich.
 * https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025
 * Dieselben belegten Zahlungsbeträge wie für den Gesamtumsatz; keine Einlagen, Darlehen, Privatnutzung oder ungeklärten Beträge.
 */
export async function kleinunternehmerAbzuege(year: number): Promise<number | undefined> {
  // Der Gesamtumsatz unterstützt die seit 2025 geltende Fassung. Ältere Jahre werden nicht nach neuem Recht umgedeutet.
  if (year < 2025) return undefined;
  const ku = await Promise.all(Array.from({ length: 12 }, (_, i) => kleinunternehmerForMonth(year, i + 1)));
  if (!ku.some(Boolean)) return undefined;
  const umsatz = await gesamtumsatzForYear(year);
  let summe = 0;
  for (const item of umsatz.items) {
    if (!item.occurredOn?.startsWith(`${year}-`) || !ku[Number(item.occurredOn.slice(5, 7)) - 1]) continue;
    if (item.net === null || item.basisSource === "unknown" || item.decision !== "excluded") continue;
    // Vor dem KU-Wechsel mit Umsatzsteuer ausgeführte Leistungen bleiben in Zeilen 15/17 (Anleitung, Zeile 12).
    if (item.gross !== null && item.gross !== item.net) continue;
    // Nur ausdrücklich belegte nicht steuerbare Betriebseinnahmen; not_turnover allein umfasst auch Einlagen/Darlehen.
    if (
      ["section4", "foreign", "asset_disposal"].includes(item.classification?.kind ?? "") ||
      (item.classification?.kind === "not_turnover" && item.nonTaxableIncome)
    )
      summe += item.net;
  }
  return summe || undefined;
}
