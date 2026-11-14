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

/**
 * Vorschläge zum Anlegen mit einem Klick, mit dem Code aus UN/ECE Recommendation 20: Meter MTR, Quadratmeter MTK,
 * Kubikmeter MTQ, laufender Meter LM (linear metre), Kilogramm KGM, Tonne TNE, Liter LTR, Stück als Rückfall C62 (one).
 */
export const UNIT_SUGGESTIONS: readonly { label: string; code: string; name: string }[] = [
  { label: "m", code: "MTR", name: "Meter" },
  { label: "m²", code: "MTK", name: "Quadratmeter" },
  { label: "m³", code: "MTQ", name: "Kubikmeter" },
  { label: "lfm", code: "LM", name: "laufender Meter" },
  { label: "kg", code: "KGM", name: "Kilogramm" },
  { label: "t", code: "TNE", name: "Tonne" },
  { label: "l", code: "LTR", name: "Liter" },
];

/** Rückfall, wenn keine Einheit aus der Liste passt, etwa für eine Unterrichtseinheit */
export const FALLBACK_UNIT_CODE = "C62";
