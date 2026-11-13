import { describe, expect, it } from "vitest";
import { andereFirmen, parseFirmen } from "./firmen.ts";

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

  // Review: Wo keine Shell und kein Compose die Anführungszeichen entfernt (haben.env der Quadlets, Felder einer
  // Oberfläche, „- NAME='…'“ in einer Compose-Liste), landen sie aus dem Beispiel der Doku im Wert; das schließende
  // hängt dann an der letzten Adresse und ergäbe einen Link auf einen Host, den es nicht gibt
  it.each([
    ["einfache Anführungszeichen um die ganze Liste", "'Studio Nord|https://nord.example.de;Werkstatt Süd|https://werkstatt.example.de'"],
    ["doppelte Anführungszeichen um die ganze Liste", '"Studio Nord|https://nord.example.de;Werkstatt Süd|https://werkstatt.example.de"'],
    ["Zeichen im Host, die es in keiner Domain gibt", "A|https://nord.example.de!"],
  ])("lehnt %s ab", (_, text) => {
    expect(parseFirmen(text)).toHaveProperty("fehler");
  });

  it("nimmt Domains mit Umlaut, Port und Unterstrich sowie die Loopback-Adressen", () => {
    expect(parseFirmen("A|https://münchen.example.de:8443;B|https://haben_nord.intern;C|http://[::1]:3201;D|http://127.0.0.1:3202")).toEqual({
      firmen: [
        { name: "A", url: "https://xn--mnchen-3ya.example.de:8443" },
        { name: "B", url: "https://haben_nord.intern" },
        { name: "C", url: "http://[::1]:3201" },
        { name: "D", url: "http://127.0.0.1:3202" },
      ],
    });
  });

  it("begrenzt die Zahl der Firmen", () => {
    const viele = Array.from({ length: 51 }, (_, i) => `F${i}|https://f${i}.example.de`).join(";");
    expect(parseFirmen(viele)).toHaveProperty("fehler");
  });
});

describe("andereFirmen", () => {
  it("gibt dem Inhaber die übrigen Firmen zum Wechseln, ohne die eigene", () => {
    expect(andereFirmen(LISTE, "https://nord.example.de", "inhaber")).toEqual([{ name: "Werkstatt Süd", url: "https://sued.example.de" }]);
  });

  it("gibt nichts, wenn nur die eigene Firma in der Liste steht", () => {
    expect(andereFirmen("Studio Nord|https://nord.example.de", "https://nord.example.de/", "inhaber")).toEqual([]);
  });

  it("gibt der Steuerberatung nichts", () => {
    expect(andereFirmen(LISTE, "https://nord.example.de", "steuerberatung")).toEqual([]);
  });

  it("listet alle zum Wechseln, wenn die eigene Adresse fehlt", () => {
    expect(andereFirmen(LISTE, "https://dritte.example.de", "inhaber")).toEqual([
      { name: "Studio Nord", url: "https://nord.example.de" },
      { name: "Werkstatt Süd", url: "https://sued.example.de" },
    ]);
  });

  it("gibt ohne oder mit ungültiger Angabe nichts", () => {
    expect(andereFirmen(undefined, "https://nord.example.de", "inhaber")).toEqual([]);
    expect(andereFirmen("kaputt", "https://nord.example.de", "inhaber")).toEqual([]);
  });
});
