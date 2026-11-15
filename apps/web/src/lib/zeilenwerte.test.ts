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
  });

  // Die elf Summenzeilen aus #1082 bleiben Schlüssel für Schlüssel erhalten: gespeicherte Zeilen hängen an ihnen
  it("ergänzt die Zeilen der Anlagen N, S, Vorsorgeaufwand, KAP und den Progressionsvorbehalt (#1149)", () => {
    const zeilen = ERKLAERTE_ZEILEN.est;
    const feld = zeilen.map((z) => z.field);
    for (const alt of [
      "bruttoarbeitslohn",
      "werbungskosten",
      "einkuenfteNichtselbstaendig",
      "einkuenfteSelbstaendig",
      "summeEinkuenfte",
      "gesamtbetrag",
      "vorsorgeaufwendungen",
      "zuVersteuerndesEinkommen",
      "festgesetzteSteuer",
      "soli",
      "erstattung",
    ])
      expect(feld).toContain(alt);
    expect(new Set(feld).size).toBe(feld.length);

    // Die Anlage steht am Feld, damit die Aufstellung sie ohne zweite Tabelle zeigen kann
    expect(new Set(zeilen.map((z) => z.gruppe))).toEqual(
      new Set(["Anlage N", "Anlage S", "Anlage Vorsorgeaufwand", "Sonderausgaben", "Anlage KAP", "Progressionsvorbehalt", "Berechnung"]),
    );
    // Reihenfolge wie im Vordruck: erst die Anlagen, dann die Berechnung
    expect(zeilen[0]?.gruppe).toBe("Anlage N");
    expect(zeilen.at(-1)?.gruppe).toBe("Berechnung");

    // Ohne die Teilbeträge ergäben die Zeilen der Anlage N nicht die Summe der Werbungskosten
    expect(feld).toEqual(expect.arrayContaining(["werbungskostenArbeitsmittel", "werbungskostenArbeitszimmer", "werbungskostenUebrige"]));
  });

  it("lässt die Anlage bei Umsatzsteuer und Anlage EÜR leer", () => {
    // Beide Erklärungen sind ein Vordruck ohne Anlagen, dort gibt es keine Gruppenzeile
    expect(ERKLAERTE_ZEILEN.ust.every((z) => !("gruppe" in z))).toBe(true);
    expect(ERKLAERTE_ZEILEN.euer.every((z) => !("gruppe" in z))).toBe(true);
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
    const felder = zeilenFelder("euer");
    expect(felder.indexOf("arbeitszimmer")).toBeLessThan(felder.indexOf("tagespauschale"));
  });
});
