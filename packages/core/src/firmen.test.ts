import { describe, expect, it } from "vitest";
import { gruppenAus, parseOrigin, parsePortalFirmen, portalFirmenFuer } from "./firmen.ts";

/*
 * Portal (#504, Stufe 2): PORTAL_FIRMEN und die Auswahl der Firmen nach den Gruppen der angemeldeten Person.
 * parseFirmen (HABEN_FIRMEN) prüfen apps/web/src/lib/firmen.test.ts und deploy/instanzen/firmen-app.test.ts.
 */

const NORD = "Studio Nord|https://nord.example.de|haben-nord-inhaber";
const SUED = "Werkstatt Süd|https://süd.example.de|haben-sued-inhaber";

describe("parsePortalFirmen", () => {
  it("liest Name, Origin und Gruppe je Firma", () => {
    expect(parsePortalFirmen(` ${NORD} ; ${SUED} ;`)).toEqual({
      firmen: [
        { name: "Studio Nord", url: "https://nord.example.de", gruppe: "haben-nord-inhaber" },
        { name: "Werkstatt Süd", url: "https://xn--sd-xka.example.de", gruppe: "haben-sued-inhaber" },
      ],
    });
  });

  it("nimmt eine leere Liste an", () => {
    expect(parsePortalFirmen("")).toEqual({ firmen: [] });
  });

  it.each([
    ["ohne Gruppe", "Studio Nord|https://nord.example.de", "Name|Adresse|Gruppe"],
    ["mit vier Teilen", `${NORD}|mehr`, "Name|Adresse|Gruppe"],
    ["mit leerer Gruppe", "Studio Nord|https://nord.example.de| ", "Gruppe mit 1 bis 100"],
    ["mit Leerzeichen in der Gruppe", "Studio Nord|https://nord.example.de|haben nord", "ohne Leerzeichen"],
    ["mit Tabulator in der Gruppe", "Studio Nord|https://nord.example.de|haben\tnord", "ohne Leerzeichen"],
    ["mit zu langer Gruppe", `Studio Nord|https://nord.example.de|${"g".repeat(101)}`, "Gruppe mit 1 bis 100"],
    ["mit Pfad in der Adresse", "Studio Nord|https://nord.example.de/app|haben-nord-inhaber", "nur https://domain"],
    ["mit http zu einem anderen Rechner", "Studio Nord|http://nord.example.de|haben-nord-inhaber", "nur https://domain"],
    ["mit zu langem Namen", `${"N".repeat(61)}|https://nord.example.de|haben-nord-inhaber`, "Name mit 1 bis 60"],
  ])("lehnt einen Eintrag %s ab", (_fall, text, fehler) => {
    const ergebnis = parsePortalFirmen(text);
    expect(ergebnis).toHaveProperty("fehler");
    expect((ergebnis as { fehler: string }).fehler).toContain(fehler);
  });

  it("lehnt eine Gruppe ab, die zwei Firmen teilen", () => {
    expect(parsePortalFirmen(`${NORD};Werkstatt Süd|https://sued.example.de|haben-nord-inhaber`)).toEqual({
      fehler: "Gruppe „haben-nord-inhaber“ steht mehrfach in der Liste",
    });
  });

  it("lehnt doppelte Namen und Adressen ab wie HABEN_FIRMEN", () => {
    expect(parsePortalFirmen(`${NORD};Studio Nord|https://andere.example.de|haben-a`)).toHaveProperty("fehler");
    expect(parsePortalFirmen(`${NORD};Andere|https://NORD.example.de:443|haben-a`)).toHaveProperty("fehler");
  });

  it("nimmt 50 Firmen an und lehnt 51 ab", () => {
    const liste = (n: number) => Array.from({ length: n }, (_, i) => `Firma ${i}|https://f${i}.example.de|haben-f${i}-inhaber`).join(";");
    expect(parsePortalFirmen(liste(50))).toHaveProperty("firmen");
    expect(parsePortalFirmen(liste(51))).toEqual({ fehler: "höchstens 50 Firmen" });
  });
});

describe("parseOrigin", () => {
  it.each([
    ["https://portal.example.de", "https://portal.example.de"],
    ["https://portal.example.de/", "https://portal.example.de"],
    ["http://localhost:3116", "http://localhost:3116"],
  ])("nimmt %s an", (adresse, origin) => {
    expect(parseOrigin(adresse)).toBe(origin);
  });

  it.each([
    "http://portal.example.de",
    "https://portal.example.de/x",
    "https://a:b@portal.example.de",
    "https://portal.example.de?x",
    "javascript:alert(1)",
    "kein url",
    "https://portal.example.de'",
  ])("lehnt %s ab", (adresse) => {
    expect(parseOrigin(adresse)).toBeNull();
  });
});

describe("gruppenAus", () => {
  it("liest den Claim wörtlich, nicht als Pfad", () => {
    expect(gruppenAus({ groups: ["a", "b"] }, "groups")).toEqual({ gruppen: ["a", "b"] });
    expect(gruppenAus({ "realm_access.roles": ["a"], realm_access: { roles: ["b"] } }, "realm_access.roles")).toEqual({ gruppen: ["a"] });
  });

  it("meldet einen fehlenden Claim, auch aus dem Prototyp", () => {
    expect(gruppenAus({}, "groups")).toEqual({ fehler: "fehlt" });
    expect(gruppenAus({}, "toString")).toEqual({ fehler: "fehlt" });
  });

  it.each([["haben-nord-inhaber"], [["a", 1]], [null], [{ 0: "a" }]])("meldet %j als ungültig", (wert) => {
    expect(gruppenAus({ groups: wert }, "groups")).toEqual({ fehler: "ungueltig" });
  });
});

describe("portalFirmenFuer", () => {
  const firmen = (parsePortalFirmen(`${SUED};${NORD};Atelier West|https://west.example.de|haben-west-inhaber`) as { firmen: never[] }).firmen;

  it("zeigt nur die Firmen aus den eigenen Gruppen, nach Namen sortiert und ohne Gruppe", () => {
    expect(portalFirmenFuer(["familie", "haben-sued-inhaber", "haben-nord-inhaber"], firmen)).toEqual([
      { name: "Studio Nord", url: "https://nord.example.de" },
      { name: "Werkstatt Süd", url: "https://xn--sd-xka.example.de" },
    ]);
  });

  it("zählt weder die Steuerberatungs-Gruppe noch eine andere Schreibweise", () => {
    expect(portalFirmenFuer(["haben-nord-steuerberatung", "HABEN-NORD-INHABER", " haben-west-inhaber"], firmen)).toEqual([]);
  });

  it("zeigt ohne Gruppen nichts", () => {
    expect(portalFirmenFuer([], firmen)).toEqual([]);
  });
});
