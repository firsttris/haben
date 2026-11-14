/**
 * Das Werkzeug prüft HABEN_FIRMEN selbst, weil es nichts aus apps/web importieren darf (es läuft ohne bun install).
 * Hier, wo beides importierbar ist, laufen dieselben Fälle gegen parseFirmen der App und gegen firmenListe des
 * Werkzeugs (#909): Was das Werkzeug schreibt, nimmt die App an, und beide urteilen gleich, bis auf die genannten
 * Fälle, in denen das Werkzeug strenger ist.
 */
import { describe, expect, it } from "vitest";
import { andereFirmen, parseFirmen } from "../../apps/web/src/lib/firmen.ts";
import { firmenListe } from "./firmen.ts";

type Fall = [beschreibung: string, firmen: [name: string, domain: string][], nurWerkzeugLehntAb?: string];

const FAELLE: Fall[] = [
  [
    "zwei Firmen",
    [
      ["Studio Nord", "nord.example.de"],
      ["Werkstatt Süd", "werkstatt.example.de"],
    ],
  ],
  ["eine Firma", [["firma1", "firma1.example.de"]]],
  ["Sonderzeichen außer | ; '", [['Müller & Söhne GmbH (Süd) $1 #2 "x"', "a.example.de"]]],
  ["Name mit 60 Zeichen", [["x".repeat(60), "a.example.de"]]],
  ["Name mit 61 Zeichen", [["x".repeat(61), "a.example.de"]]],
  ["leerer Name", [["", "a.example.de"]]],
  ["Name mit Zeilenumbruch", [["A\nB", "a.example.de"]]],
  ["Name mit Tabulator", [["A\tB", "a.example.de"]]],
  ["Name mit DEL", [["A\u007fB", "a.example.de"]]],
  ["Name mit |", [["A|B", "a.example.de"]]],
  ["Name mit ;", [["A;B", "a.example.de"]]],
  [
    "doppelter Name",
    [
      ["Nord", "a.example.de"],
      ["Nord", "b.example.de"],
    ],
  ],
  [
    "doppelter Name, einer mit Leerzeichen am Ende",
    [
      ["Nord", "a.example.de"],
      ["Nord ", "b.example.de"],
    ],
  ],
  ["Name mit Leerzeichen am Rand", [[" Nord", "a.example.de"]], "die App schneidet es ab; „Nord“ und „ Nord“ sähen gleich aus"],
  ["nur Leerzeichen", [[" ", "a.example.de"]]],
  ["Name mit '", [["it's", "a.example.de"]], "der Wert steht in einfachen Anführungszeichen in der .env"],
  ["Name mit \\ am Ende", [["Nord\\", "a.example.de"]], "Compose liest \\' in HABEN_FIRMENNAME als Zeichen, der Wert endete nie"],
  ["Name mit \\ in der Mitte", [["A\\B", "a.example.de"]]],
  [
    "doppelte Domain",
    [
      ["A", "a.example.de"],
      ["B", "a.example.de"],
    ],
  ],
  [
    "doppelte Domain in anderer Schreibweise",
    [
      ["A", "a.example.de"],
      ["B", "A.Example.DE"],
    ],
  ],
  ["leere Domain", [["A", ""]]],
  ["Domain mit Pfad", [["A", "a.example.de/haben"]]],
  ["Domain mit Port", [["A", "a.example.de:8443"]]],
  ["Domain mit Query", [["A", "a.example.de?x=1"]]],
  ["Domain mit Zugangsdaten", [["A", "user@a.example.de"]]],
  ["Domain mit Anführungszeichen", [["A", "a.example.de'"]]],
  ["50 Firmen", Array.from({ length: 50 }, (_, i) => [`F${i}`, `f${i}.example.de`] as [string, string])],
  ["51 Firmen", Array.from({ length: 51 }, (_, i) => [`F${i}`, `f${i}.example.de`] as [string, string])],
];

const eintraege = (firmen: Fall[1]) => firmen.map(([name, domain], i) => ({ instanz: `firma${i + 1}`, name, domain }));

function werkzeug(firmen: Fall[1]): { liste: string } | { fehler: string } {
  try {
    return { liste: firmenListe(eintraege(firmen)) };
  } catch (error) {
    return { fehler: (error as Error).message };
  }
}

describe.each(FAELLE)("%s", (_, firmen, nurWerkzeugLehntAb) => {
  const ergebnis = werkzeug(firmen);

  it("urteilt wie parseFirmen", () => {
    const app = parseFirmen(firmen.map(([name, domain]) => `${name}|https://${domain}`).join(";"));
    if (nurWerkzeugLehntAb) {
      expect("fehler" in ergebnis, nurWerkzeugLehntAb).toBe(true);
      return;
    }
    expect("fehler" in ergebnis, JSON.stringify(ergebnis)).toBe("fehler" in app);
  });

  it("schreibt nur eine Liste, die die App annimmt, mit allen Firmen", () => {
    if ("fehler" in ergebnis) return;
    const app = parseFirmen(ergebnis.liste);
    expect(app).toEqual({ firmen: firmen.map(([name, domain]) => ({ name, url: new URL(`https://${domain}`).origin })) });
  });
});

it("nennt im Fehler die Instanz", () => {
  expect(
    werkzeug([
      ["A", "a.example.de"],
      ["x".repeat(61), "b.example.de"],
    ]),
  ).toEqual({ fehler: expect.stringContaining("firma2") });
});

it("zeigt nach firmen in der Navigation jeder Instanz die jeweils anderen Firmen", () => {
  const liste = firmenListe(
    eintraege([
      ["Studio Nord", "nord.example.de"],
      ["Werkstatt", "werkstatt.example.de"],
      ["firma3", "firma3.example.de"],
    ]),
  );
  expect(andereFirmen(liste, "https://werkstatt.example.de", "inhaber").map((f) => f.name)).toEqual(["Studio Nord", "firma3"]);
  expect(andereFirmen(liste, "https://nord.example.de", "inhaber").map((f) => f.name)).toEqual(["Werkstatt", "firma3"]);
});
