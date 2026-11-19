import { describe, expect, it } from "vitest";
import { privatanteilKurz } from "../PrivatanteilVorgaben.tsx";
import { abschnittAusAnker } from "./EinklappAbschnitt.tsx";
import { fremdwaehrungKurz, handelsregisterKurz, mahnwesenKurz } from "./kurzwerte.ts";

describe("Kurzwerte der einklappbaren Abschnitte der Firmendaten (#1253)", () => {
  it("Mahnwesen nennt Zinssatz und Gebühren, sonst was fehlt", () => {
    expect(mahnwesenKurz("2,27", { "1": "", "2": "5,00", "3": "10,00" })).toBe("Basiszinssatz 2,27 % · Gebühren 0 / 5,00 / 10,00 €");
    expect(mahnwesenKurz("", { "1": "", "2": "", "3": "0,00" })).toBe("ohne Verzugszinsen · ohne Gebühren");
  });

  it("Privatanteile nennen nur Vorgaben über 0 %, ein unlesbarer Text zählt nicht", () => {
    expect(privatanteilKurz({ telefon: "20 %", internet: "50" })).toBe("Telefon 20 % · Internet 50 %");
    expect(privatanteilKurz({ telefon: "0", internet: "abc" })).toBe("keine Vorgabe");
  });

  it("Handelsregister nennt die Registernummer und, ob Pflichtangaben fehlen", () => {
    expect(handelsregisterKurz(" HRB 12345 HB ", false)).toBe("HRB 12345 HB");
    expect(handelsregisterKurz("", true)).toBe("unvollständig");
    expect(handelsregisterKurz("HRB 1", true)).toBe("HRB 1 · unvollständig");
  });

  it("Fremdwährung nennt, womit umgerechnet wird", () => {
    expect(fremdwaehrungKurz(true)).toBe("Tageskurs");
    expect(fremdwaehrungKurz(false)).toBe("Umrechnungskurse des BMF");
  });

  it("der Anker einer Adresse klappt nur einen bekannten Abschnitt auf", () => {
    expect(abschnittAusAnker("company-dunning")).toBe("company-dunning");
    expect(abschnittAusAnker("company-bank")).toBeNull();
    expect(abschnittAusAnker("")).toBeNull();
  });
});
