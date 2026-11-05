import {
  type AssetMethod,
  type CarPrivateUse,
  ELEKTRO_NUR_EINZELUNTERNEHMEN,
  elektroAvailable,
  maxDegressiveRate,
  type Rechtsform,
  usesUsefulLife,
} from "@haben/core";

/*
 * Regeln je Abschreibungsmethode beim Anlegen und Ändern einer Anlage (docs/anlagen.md): degressive AfA nach § 7 Abs. 2
 * und 3 EStG, Elektrofahrzeuge nach § 7 Abs. 2a EStG. Die Rechnung selbst steht in @haben/core (afa.ts).
 */

/**
 * Felder, die nur zu bestimmten Methoden gehören: Nutzungsdauer bei linear und degressiv, Satz und Wechsel nur bei
 * degressiv. Ohne Satz gilt bei degressiv der Höchstsatz für Anschaffungsdatum und Nutzungsdauer.
 */
export function methodValues(
  method: AssetMethod,
  v: { acquisitionDate: string; usefulLifeMonths?: number | null; degressiveRate?: number | null; linearFromYear?: number | null },
) {
  const usefulLifeMonths = usesUsefulLife(method) ? (v.usefulLifeMonths ?? null) : null;
  const degressive = method === "degressiv";
  const maxRate = degressive && usefulLifeMonths ? maxDegressiveRate(v.acquisitionDate, usefulLifeMonths) : null;
  return {
    usefulLifeMonths,
    degressiveRate: degressive ? (v.degressiveRate ?? maxRate) : null,
    linearFromYear: degressive ? (v.linearFromYear ?? null) : null,
  };
}

/**
 * Wechsel von der degressiven zur linearen AfA nach der ersten Buchung (§ 7 Abs. 3 Satz 1 EStG): nur in ein Jahr ohne
 * gebuchte AfA, und ein schon gebuchter Wechsel bleibt (Satz 3: kein Zurück). Der Trigger haben_reject_booked_asset
 * prüft dasselbe. null: zulässig.
 */
export function switchToLinearProblem(
  asset: { method: AssetMethod; linearFromYear: number | null },
  year: number | null,
  lastBooked: number | null,
): string | null {
  if (asset.method !== "degressiv") return "Den Wechsel zur linearen AfA gibt es nur bei der degressiven.";
  if (lastBooked === null) return null;
  if (asset.linearFromYear !== null && asset.linearFromYear <= lastBooked) {
    return `Die AfA ist seit ${asset.linearFromYear} linear gebucht; zurück zur degressiven geht nicht.`;
  }
  if (year !== null && year <= lastBooked) return `Für ${lastBooked} ist die AfA schon gebucht; der Wechsel geht frühestens ${lastBooked + 1}.`;
  return null;
}

/**
 * § 7 Abs. 2a EStG gilt nur für Elektrofahrzeuge; ist der Antrieb bei der Privatnutzung erfasst, muss er passen. In GmbH
 * und UG bietet Haben die Staffel nicht an (elektroAvailable in @haben/core).
 */
export function elektroIssues(asset: { method: AssetMethod; privateUse: CarPrivateUse | null }, rechtsform: Rechtsform): string[] {
  if (asset.method !== "elektro") return [];
  if (!elektroAvailable(rechtsform)) return [ELEKTRO_NUR_EINZELUNTERNEHMEN];
  return asset.privateUse && asset.privateUse.drive !== "elektro" ? ["AfA nach § 7 Abs. 2a EStG nur für reine Elektrofahrzeuge"] : [];
}
