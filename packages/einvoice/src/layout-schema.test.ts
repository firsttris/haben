import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutBeispiele } from "./layout-beispiele.ts";
import { belegDatenSchema, LAYOUT_SCHEMA_VERSION, layoutJsonSchema, mahnungDatenSchema } from "./layout-schema.ts";
import { contractBreaks, type FrozenField, flattenSchema } from "./layout-schema-paths.ts";

const schema = layoutJsonSchema();
const aktuell = { beleg: flattenSchema(schema.beleg as never), mahnung: flattenSchema(schema.mahnung as never) };

describe("Feldvertrag der Belegvorlagen", () => {
  it.each(layoutBeispiele().map((b) => [b.name, b] as const))("%s: jedes Feld der Daten steht im Vertrag", (_name, beispiel) => {
    const vertrag = beispiel.art === "beleg" ? belegDatenSchema : mahnungDatenSchema;
    const ergebnis = vertrag.safeParse(beispiel.data);
    // Ein neues Feld in den Daten gehört mit Beschreibung in layout-schema.ts, sonst kennen es eigene Layouts nicht
    expect(ergebnis.success, JSON.stringify(ergebnis.error?.issues, null, 2)).toBe(true);
  });

  it("beschreibt jedes Feld", () => {
    const ohne = [...aktuell.beleg, ...aktuell.mahnung].filter((feld) => !feld.description.trim()).map((feld) => feld.path);
    expect(ohne).toEqual([]);
  });

  it("die Beispiele nutzen jedes Feld des Vertrags mindestens einmal", () => {
    const gesehen = new Set<string>();
    const sammeln = (wert: unknown, pfad: string) => {
      if (pfad) gesehen.add(pfad);
      if (Array.isArray(wert)) for (const x of wert) sammeln(x, `${pfad}[]`);
      else if (wert && typeof wert === "object") for (const [k, x] of Object.entries(wert)) sammeln(x, pfad ? `${pfad}.${k}` : k);
    };
    for (const b of layoutBeispiele()) sammeln(b.data, "");
    const fehlen = [...aktuell.beleg, ...aktuell.mahnung].map((feld) => feld.path).filter((pfad) => !gesehen.has(pfad));
    expect([...new Set(fehlen)]).toEqual([]);
  });
});

describe("Eingefrorener Stand des Vertrags", () => {
  const eingefroren = JSON.parse(readFileSync(new URL(`./layout-schema.v${LAYOUT_SCHEMA_VERSION}.json`, import.meta.url), "utf8")) as {
    version: number;
    beleg: FrozenField[];
    mahnung: FrozenField[];
  };

  it.each(["beleg", "mahnung"] as const)("%s: kein Feld fällt weg, wird umbenannt, wechselt den Typ oder wird optional", (art) => {
    const brueche = contractBreaks(eingefroren[art], aktuell[art]);
    // Ein Bruch braucht eine neue LAYOUT_SCHEMA_VERSION mit Adapter für alte Layouts (docs/belegvorlagen.md)
    expect(brueche).toEqual([]);
  });
});

describe("Vergleich mit dem eingefrorenen Stand", () => {
  const alt: FrozenField[] = [
    { path: "title", type: "string", required: true },
    { path: "note", type: "null | string", required: true },
  ];

  it("erlaubt neue Felder", () => {
    expect(contractBreaks(alt, [...alt, { path: "neu", type: "string", required: false }])).toEqual([]);
  });

  it("meldet ein weggefallenes oder umbenanntes Feld", () => {
    expect(contractBreaks(alt, [{ path: "titel", type: "string", required: true }, alt[1]!])).toEqual(["title fehlt"]);
  });

  it("meldet einen anderen Typ, auch ein neu erlaubtes null", () => {
    expect(contractBreaks(alt, [{ path: "title", type: "null | string", required: true }, alt[1]!])).toEqual(["title: string → null | string"]);
  });

  it("meldet ein Feld, das nicht mehr immer da ist", () => {
    expect(contractBreaks(alt, [{ path: "title", type: "string", required: false }, alt[1]!])).toEqual(["title ist nicht mehr immer da"]);
  });
});
