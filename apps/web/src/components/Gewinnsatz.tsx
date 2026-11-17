import { formatEuro, type EuerResult } from "@haben/core";

/** Gewinn oder Verlust laut EÜR in einem Satz, mit den Summen, aus denen er sich ergibt; ohne Buchungen im Jahr kein Satz */
export function gewinnSatz({
  year,
  totalEinnahmen,
  totalAusgaben,
  gewinn,
}: Pick<EuerResult, "year" | "totalEinnahmen" | "totalAusgaben" | "gewinn">): string | null {
  if (totalEinnahmen === 0 && totalAusgaben === 0) return null;
  return `Du hast ${year} ${formatEuro(Math.abs(gewinn))} ${gewinn >= 0 ? "Gewinn" : "Verlust"} gemacht: Einnahmen ${formatEuro(totalEinnahmen)} minus Ausgaben ${formatEuro(totalAusgaben)} (brutto, wie in der EÜR).`;
}

export function Gewinnsatz({ euer }: { euer: Parameters<typeof gewinnSatz>[0] }) {
  const satz = gewinnSatz(euer);
  return satz && <p style={{ margin: "0 0 16px" }}>{satz}</p>;
}
