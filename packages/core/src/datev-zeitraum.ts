/** Zeitraum eines DATEV-Buchungsstapels: ganzes Jahr (Vorgabe), Quartal (Q1–Q4) oder Monat (1–12) */
export type DatevZeitraum = { kind: "jahr" } | { kind: "quartal"; quartal: 1 | 2 | 3 | 4 } | { kind: "monat"; monat: number };

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Letzter Kalendertag eines Monats (1–12) im gegebenen Jahr, einschließlich Schaltjahr */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Parst einen Zeitraum-Parameter aus URL oder Auswahlfeld (`""`/`"jahr"`, `"Q1"`–`"Q4"`, `"01"`–`"12"` bzw. `"1"`–`"12"`).
 * Gibt `null` zurück, wenn der Wert ungültig ist.
 */
export function parseDatevZeitraum(raw: string | null | undefined): DatevZeitraum | null {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "" || trimmed.toLowerCase() === "jahr") return { kind: "jahr" };
  const qMatch = /^q([1-4])$/i.exec(trimmed);
  if (qMatch) return { kind: "quartal", quartal: Number(qMatch[1]) as 1 | 2 | 3 | 4 };
  const mMatch = /^(0?[1-9]|1[0-2])$/.exec(trimmed);
  if (mMatch) return { kind: "monat", monat: Number(mMatch[1]) };
  return null;
}

/** Eindeutiger Schlüssel für URL-Parameter und `<select>` (`""` für ganzes Jahr, `"Q1"`–`"Q4"`, `"01"`–`"12"`) */
export function datevZeitraumKey(zeitraum: DatevZeitraum): string {
  if (zeitraum.kind === "jahr") return "";
  if (zeitraum.kind === "quartal") return `Q${zeitraum.quartal}`;
  return pad2(zeitraum.monat);
}

/** Datumsbereich (ISO YYYY-MM-DD), Dateiname und Kopfbezeichnung (max. 30 Zeichen für DATEV EXTF) */
export function datevZeitraumBereich(year: number, zeitraum: DatevZeitraum): { dateFrom: string; dateTo: string; filename: string; description: string } {
  if (zeitraum.kind === "jahr") {
    return {
      dateFrom: `${year}-01-01`,
      dateTo: `${year}-12-31`,
      filename: `EXTF_Buchungsstapel_${year}.csv`,
      description: `Haben ${year}`,
    };
  }
  if (zeitraum.kind === "quartal") {
    const startMonth = (zeitraum.quartal - 1) * 3 + 1;
    const endMonth = zeitraum.quartal * 3;
    return {
      dateFrom: `${year}-${pad2(startMonth)}-01`,
      dateTo: `${year}-${pad2(endMonth)}-${pad2(lastDayOfMonth(year, endMonth))}`,
      filename: `EXTF_Buchungsstapel_${year}-Q${zeitraum.quartal}.csv`,
      description: `Haben ${year} Q${zeitraum.quartal}`,
    };
  }
  const mm = pad2(zeitraum.monat);
  return {
    dateFrom: `${year}-${mm}-01`,
    dateTo: `${year}-${mm}-${pad2(lastDayOfMonth(year, zeitraum.monat))}`,
    filename: `EXTF_Buchungsstapel_${year}-${mm}.csv`,
    description: `Haben ${year}-${mm}`,
  };
}
