import { EUER_FIELDS } from "@haben/elster/euer-felder";
import { describe, expect, it } from "vitest";
import { ERKLAERTE_ZEILEN, mitVorzeichen, zeilenFelder } from "./zeilenwerte.ts";

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

  // Der Vordruck druckt die Schlusszeile ohne Richtung, die Vermerke führen Erstattungen negativ (#1082)
  it("richtet das Ergebnis der Veranlagung nach dem Vermerk aus", () => {
    expect(mitVorzeichen("erstattung", 1_032_197, -1_032_197)).toBe(-1_032_197);
    expect(mitVorzeichen("erstattung", 1_032_197, null)).toBe(1_032_197);
    expect(mitVorzeichen("erstattung", 1_032_197, undefined)).toBe(1_032_197);
  });

  it("lässt eine Nachzahlung positiv und andere Zeilen unberührt", () => {
    expect(mitVorzeichen("erstattung", 420_00, 420_00)).toBe(420_00);
    expect(mitVorzeichen("festgesetzteSteuer", 2_012_700, -1_032_197)).toBe(2_012_700);
  });

  it("führt Zeile 65 der Anlage EÜR, obwohl sie kein Feld in EUER_FIELDS hat (#1072)", () => {
    // Im Protokoll steht "Aufwendungen für ein häusliches Arbeitszimmer" mit einem Betrag; ohne eigene Zeile fehlt
    // er in der Aufstellung und die Einzelzeilen ergeben weniger als die Summe der Betriebsausgaben
    const zeile = ERKLAERTE_ZEILEN.euer.find((z) => z.field === "arbeitszimmer");
    expect(zeile?.text).toBe("Aufwendungen für ein häusliches Arbeitszimmer (abziehbar)");
    expect(zeilenFelder("euer")).toContain("arbeitszimmer");
  });

  it("meint die Spalte „abziehbar“ und steht wie im Vordruck vor der Tagespauschale (#1072)", () => {
    // Die Zeile hat zwei Spalten: nicht abziehbar (E6005102) und abziehbar (E6003101); zur Summe der Betriebsausgaben
    // zählt nur die zweite (ERiC-Prüfplugin EUER 2025, /EUER/BAus/Beschr_abziehbar/Abziehbar/Arbeitszimmer/Sum/E6003101)
    const felder = zeilenFelder("euer");
    expect(ERKLAERTE_ZEILEN.euer.find((z) => z.field === "arbeitszimmer")?.text).toBe("Aufwendungen für ein häusliches Arbeitszimmer (abziehbar)");
    expect(felder.indexOf("arbeitszimmer")).toBe(felder.indexOf("tagespauschale") - 1);
  });
});
