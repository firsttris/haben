import { EUER_FIELDS } from "@haben/elster/euer-felder";
import { describe, expect, it } from "vitest";
import { zeilenFelder } from "./zeilenwerte.ts";

describe("erklärte Zeilen (#997)", () => {
  it("nimmt jede Zeile der Anlage EÜR auf, die Haben selbst übermittelt (EUER_FIELDS)", () => {
    // Haben schreibt auch E6004101 und E6004301 ins XML (packages/elster/src/erklaerung.ts); eine außerhalb
    // abgegebene Erklärung kann sie also ebenso enthalten
    const felder = new Set(zeilenFelder("euer"));
    expect(Object.keys(EUER_FIELDS).filter((k) => !felder.has(k))).toEqual([]);
  });

  it("führt für die Einkommensteuer die Zeilen des Vordrucks (#1082)", () => {
    const feld = zeilenFelder("est");
    // Diese Zeilen kann Haben nicht aus den Buchungen rechnen; sie stehen im Vordruck der abgegebenen Erklärung
    expect(feld).toContain("bruttoarbeitslohn");
    expect(feld).toContain("zuVersteuerndesEinkommen");
    expect(feld).toContain("festgesetzteSteuer");
    expect(feld).toContain("erstattung");
    expect(new Set(feld).size).toBe(feld.length);
    expect(feld.length).toBe(11);
  });
});
