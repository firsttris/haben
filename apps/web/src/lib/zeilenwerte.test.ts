import { EUER_FIELDS } from "@haben/elster/euer-felder";
import { describe, expect, it } from "vitest";
import { ERKLAERTE_ZEILEN, zeilenFelder } from "./zeilenwerte.ts";

describe("erklärte Zeilen (#997)", () => {
  it("nimmt jede Zeile der Anlage EÜR auf, die Haben selbst übermittelt (EUER_FIELDS)", () => {
    // Haben schreibt auch E6004101 und E6004301 ins XML (packages/elster/src/erklaerung.ts); eine außerhalb
    // abgegebene Erklärung kann sie also ebenso enthalten
    const felder = new Set(zeilenFelder("euer"));
    expect(Object.keys(EUER_FIELDS).filter((k) => !felder.has(k))).toEqual([]);
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
