import { UNITS, type UnitLabel } from "@haben/core";

/**
 * Code der Einheit nach UN/ECE Rec. 20/21 (BT-130): bei einer eigenen Einheit (#748) aus der Position, bei einer festen aus
 * UNITS; undefined, wenn keiner bekannt ist (validateForFormat meldet das vor dem Festschreiben).
 */
export function unitCodeOf(line: { unit: string; unitCode?: string }): string | undefined {
  return line.unitCode ?? (Object.hasOwn(UNITS, line.unit) ? UNITS[line.unit as UnitLabel] : undefined);
}
