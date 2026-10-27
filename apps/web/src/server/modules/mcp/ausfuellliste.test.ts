import { computeUstva } from "@haben/core";
import { describe, expect, it } from "vitest";
import { ustvaAusfuellliste } from "./ausfuellliste.ts";

describe("Ausfüllliste für Mein ELSTER", () => {
  it("nennt nur Felder mit Wert, in der Reihenfolge des Formulars und wie man sie eintippt", () => {
    const liste = ustvaAusfuellliste(computeUstva({ kz81: 234_567, kz86: 0, kz21: 100_050, kz66: 12_345, kz46: 50_099, kz47: 9_519 }), false);
    expect(liste.felder.map((f) => f.kz)).toEqual([81, 46, 47, 21, 66]);
    expect(liste.felder.map((f) => f.eingabe)).toEqual(["2345", "500", "95,19", "1000", "123,45"]);
    expect(liste.zumVergleich).toEqual([
      { bezeichnung: "Steuer zu Kz 81", wert: "445,55" },
      { bezeichnung: "Kz 83 Verbleibende Umsatzsteuer-Vorauszahlung", wert: "417,29" },
    ]);
  });

  it("setzt Kz 10 bei einer berichtigten Anmeldung und nennt einen Überschuss als solchen", () => {
    const liste = ustvaAusfuellliste(computeUstva({ kz81: 0, kz86: 0, kz66: 1_005 }), true);
    expect(liste.felder).toEqual([
      { kz: 10, abschnitt: "Allgemeine Angaben", bezeichnung: "Berichtigte Anmeldung", eingabe: "1" },
      expect.objectContaining({ kz: 66, eingabe: "10,05" }),
    ]);
    expect(liste.zumVergleich).toEqual([{ bezeichnung: "Kz 83 Verbleibender Überschuss", wert: "-10,05" }]);
  });

  it("schreibt negative Bemessungsgrundlagen mit Minus", () => {
    const liste = ustvaAusfuellliste(computeUstva({ kz81: -50_000, kz86: 0, kz66: 0 }), false);
    expect(liste.felder).toEqual([expect.objectContaining({ kz: 81, eingabe: "-500" })]);
  });
});
