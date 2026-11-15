import { charactersWithoutFont } from "./footer-template.ts";
import { UNITS } from "./invoice.ts";

/*
 * Eigene Mengeneinheiten (#748): Neben den festen Einheiten (UNITS) legt der Betrieb eigene an, etwa „UE“ für eine
 * Unterrichtseinheit oder „m²“. Jede hat einen Code nach UN/ECE Recommendation 20 mit Rec. 21 für die E-Rechnung (BT-130,
 * EN 16931 BR-CL-23); die Liste der erlaubten Codes steht in packages/einvoice/src/codelisten.ts.
 */

/** Längste Bezeichnung: Sie steht in der Mengenspalte des Belegs */
export const UNIT_LABEL_MAX = 10;

/** Warum sich die Bezeichnung nicht anlegen lässt; leer = in Ordnung. existing: schon angelegte eigene Einheiten */
export function unitLabelIssues(label: string, existing: readonly string[]): string[] {
  const value = label.trim();
  if (!value) return ["Bezeichnung fehlt"];
  const issues: string[] = [];
  if (value.length > UNIT_LABEL_MAX) issues.push(`Höchstens ${UNIT_LABEL_MAX} Zeichen`);
  const key = value.toLowerCase();
  if ([...Object.keys(UNITS), ...existing].some((other) => other.toLowerCase() === key)) issues.push(`Die Einheit „${value}“ gibt es schon`);
  const foreign = charactersWithoutFont(value);
  if (foreign.length > 0) issues.push(`Diese Zeichen enthält keine Belegschrift, das PDF ließe sich nicht erzeugen: ${foreign.join(" ")}`);
  return issues;
}

/** Rückfall, wenn keine Einheit aus der Liste passt, etwa für eine Unterrichtseinheit */
export const FALLBACK_UNIT_CODE = "C62";
