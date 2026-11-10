import { describe, expect, it } from "vitest";
import { firmenSicht, parseFirmen } from "./firmen.ts";

const LISTE = "Studio Nord|https://nord.example.de; Werkstatt Süd|https://sued.example.de/ ;";

describe("parseFirmen", () => {
  it("liest Name und Origin je Firma", () => {
    expect(parseFirmen(LISTE)).toEqual({
      firmen: [
        { name: "Studio Nord", url: "https://nord.example.de" },
        { name: "Werkstatt Süd", url: "https://sued.example.de" },
      ],
    });
  });

  it("nimmt eine leere Angabe als keine Firmen", () => {
    expect(parseFirmen("")).toEqual({ firmen: [] });
    expect(parseFirmen(" ; ")).toEqual({ firmen: [] });
  });

  it("erlaubt HTTP nur für localhost", () => {
    expect(parseFirmen("Lokal|http://localhost:3201")).toEqual({ firmen: [{ name: "Lokal", url: "http://localhost:3201" }] });
    expect(parseFirmen("A|http://nord.example.de")).toHaveProperty("fehler");
  });

  it.each([
    ["ohne Trenner", "Studio Nord https://nord.example.de"],
    ["zwei Trenner", "A|B|https://nord.example.de"],
    ["leerer Name", "|https://nord.example.de"],
    ["Steuerzeichen im Namen", "Nord\u0007|https://nord.example.de"],
    ["zu langer Name", `${"x".repeat(61)}|https://nord.example.de`],
    ["Pfad", "A|https://example.de/haben"],
    ["Query", "A|https://nord.example.de/?x=1"],
    ["leere Query", "A|https://nord.example.de?"],
    ["Fragment", "A|https://nord.example.de#a"],
    ["Zugangsdaten", "A|https://ich:geheim@nord.example.de"],
    ["anderes Schema", "A|javascript:alert(1)"],
    ["keine Adresse", "A|nord.example.de"],
    ["doppelte Adresse", "A|https://nord.example.de;B|https://nord.example.de/"],
    ["doppelter Name", "A|https://nord.example.de;A|https://sued.example.de"],
  ])("lehnt %s ab", (_, text) => {
    expect(parseFirmen(text)).toHaveProperty("fehler");
  });

  it("begrenzt die Zahl der Firmen", () => {
    const viele = Array.from({ length: 51 }, (_, i) => `F${i}|https://f${i}.example.de`).join(";");
    expect(parseFirmen(viele)).toHaveProperty("fehler");
  });
});

describe("firmenSicht", () => {
  it("zeigt dem Inhaber die eigene Firma und die übrigen zum Wechseln", () => {
    expect(firmenSicht(LISTE, "https://nord.example.de", "inhaber")).toEqual({
      aktuell: "Studio Nord",
      andere: [{ name: "Werkstatt Süd", url: "https://sued.example.de" }],
    });
  });

  it("zeigt der Steuerberatung nur den Namen der eigenen Firma, nicht die übrigen", () => {
    expect(firmenSicht(LISTE, "https://nord.example.de", "steuerberatung")).toEqual({ aktuell: "Studio Nord", andere: [] });
  });

  it("listet alle zum Wechseln, wenn die eigene Adresse fehlt", () => {
    expect(firmenSicht(LISTE, "https://dritte.example.de", "inhaber")).toEqual({
      aktuell: null,
      andere: [
        { name: "Studio Nord", url: "https://nord.example.de" },
        { name: "Werkstatt Süd", url: "https://sued.example.de" },
      ],
    });
  });

  it("zeigt ohne oder mit ungültiger Angabe nichts", () => {
    expect(firmenSicht(undefined, "https://nord.example.de", "inhaber")).toEqual({ aktuell: null, andere: [] });
    expect(firmenSicht("kaputt", "https://nord.example.de", "inhaber")).toEqual({ aktuell: null, andere: [] });
  });
});
