import { describe, expect, it } from "vitest";
import { privatanteilFehler, privatanteilTexte, privatanteilWerte } from "./PrivatanteilVorgaben.tsx";

describe("Vorgaben für den Privatanteil (#1221)", () => {
  it("liest ganze Prozent von 0 bis 100, auch mit „%“; leer und 0 heißen kein Anteil", () => {
    const texte = { telefon: "20 %", internet: "" };
    expect(privatanteilFehler(texte, false)).toEqual({ "privateShare-telefon": null, "privateShare-internet": null });
    expect(privatanteilWerte(texte, false)).toEqual({ telefon: 20 });
    expect(privatanteilWerte({ telefon: "0", internet: "100" }, false)).toEqual({ internet: 100 });
  });

  it("meldet am Feld, was keine ganze Zahl von 0 bis 100 ist, statt es still zu verwerfen", () => {
    for (const text of ["20,5", "150", "abc", "-5"]) {
      expect(privatanteilFehler({ telefon: text, internet: "" }, false)["privateShare-telefon"], text).toBe("Trag eine ganze Zahl von 0 bis 100 ein.");
    }
  });

  it("hat in einer Kapitalgesellschaft weder Felder noch Fehler noch Werte", () => {
    expect(privatanteilFehler({ telefon: "abc", internet: "" }, true)).toEqual({ "privateShare-telefon": null, "privateShare-internet": null });
    expect(privatanteilWerte({ telefon: "20", internet: "" }, true)).toEqual({});
  });

  it("zeigt gespeicherte Vorgaben als Text", () => {
    expect(privatanteilTexte({ telefon: 20 })).toEqual({ telefon: "20", internet: "" });
  });
});
