import { describe, expect, it } from "vitest";
import { builtinFindings } from "./catalog-objects.ts";

const sollbestand = {
  major: 18,
  functions: [
    { name: "pg_catalog.age(timestamp without time zone)", hash: "a" },
    { name: "pg_catalog.big5_to_utf8(integer, integer, cstring, internal, integer, boolean)", hash: "b" },
  ],
};

describe("Eingebaute Funktionen gegen den Sollbestand", () => {
  it("meldet nichts, wenn alles übereinstimmt", () => {
    expect(builtinFindings(sollbestand, { ...sollbestand })).toEqual({ problems: [], hints: [] });
  });

  it("meldet eine durch eigenen Code ersetzte, eine veränderte und eine fehlende Funktion", () => {
    expect(
      builtinFindings(sollbestand, {
        major: 18,
        functions: [
          { name: "pg_catalog.age(timestamp without time zone)", hash: "x" },
          { name: "pg_catalog.to_jsonb(anyelement)", hash: "c" },
        ],
      }),
    ).toEqual({
      problems: [
        "Eingebaute Funktion pg_catalog.age(timestamp without time zone) wurde verändert",
        "Eingebaute Funktion pg_catalog.big5_to_utf8(integer, integer, cstring, internal, integer, boolean) fehlt oder wurde verändert",
        "Eingebaute Funktion pg_catalog.to_jsonb(anyelement) durch eigenen Code ersetzt",
      ],
      hints: [],
    });
  });

  // Die eingebauten Funktionen unterscheiden sich zwischen Hauptversionen; ein Vergleich ergäbe dort nur Fehlalarme
  it("vergleicht auf einer anderen Hauptversion nicht und gibt einen Hinweis", () => {
    expect(builtinFindings(sollbestand, { major: 17, functions: [] })).toEqual({
      problems: [],
      hints: ["Eingebaute Funktionen nicht geprüft: Der Sollbestand gilt für PostgreSQL 18, der Server hat 17"],
    });
  });
});
