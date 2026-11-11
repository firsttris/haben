import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gestaltungsHinweise, type LayoutJeBeleg, ungenutzteGestaltung } from "./layout-gestaltung.ts";
import { LAYOUT_GESTALTUNG, layoutJsonSchema } from "./layout-schema.ts";
import { flattenSchema } from "./layout-schema-paths.ts";
import { startvorlage } from "./layout-startvorlage.ts";
import { PACKAGE_DIR } from "./typst-compiler.ts";

const vorlage = (datei: string) => readFileSync(join(PACKAGE_DIR, "templates", datei), "utf8");
/** Ein Feld aus dem Quelltext entfernen, wie es ein eigenes Layout weglässt */
const ohne = (source: string, feld: string) => source.replace(new RegExp(`(?<![A-Za-z0-9_])${feld}(?![A-Za-z0-9_])`, "g"), "x");

describe("Einstellungen, die ein eigenes Layout nicht verwendet", () => {
  it("jedes Feld der Zuordnung steht im Feldvertrag der Arten, auf die die Einstellung wirkt", () => {
    const schema = layoutJsonSchema();
    const pfade = {
      beleg: new Set(flattenSchema(schema.beleg as never).map((f) => f.path)),
      mahnung: new Set(flattenSchema(schema.mahnung as never).map((f) => f.path)),
    };
    for (const [option, { felder, belege }] of Object.entries(LAYOUT_GESTALTUNG)) {
      for (const type of belege) {
        const art = type === "mahnung" ? "mahnung" : "beleg";
        for (const pfad of felder.split("|")) expect(pfade[art].has(pfad), `${option}: ${pfad} (${art})`).toBe(true);
      }
    }
  });

  it("die eingebauten Vorlagen und die Startvorlagen verwenden jede Einstellung", () => {
    expect(ungenutzteGestaltung(startvorlage("beleg"), "beleg")).toEqual([]);
    expect(ungenutzteGestaltung(startvorlage("mahnung"), "mahnung")).toEqual([]);
    expect(ungenutzteGestaltung(vorlage("rechnung.typ"), "beleg")).not.toContain("foldMarks");
  });

  it("meldet ein Layout ohne GiroCode und ohne Falzmarken", () => {
    const source = ohne(ohne(startvorlage("beleg"), "qr"), "foldMarks");
    expect(ungenutzteGestaltung(source, "beleg")).toEqual(["foldMarks", "giroCode"]);
  });

  it("ein Feld von mehreren genügt, ein längerer Name zählt nicht", () => {
    expect(
      ungenutzteGestaltung("d.palette.ink d.font d.logo d.look.logoWidth d.look.logoLeft d.look.foldMarks d.qr d.background d.look.backgroundPages", "mahnung"),
    ).toEqual([]);
    // qrPlaceholder ist nicht qr, itemNumber nicht itemNumbers
    const nur = ungenutzteGestaltung("d.qrPlaceholder l.itemNumber", "beleg");
    expect(nur).toContain("giroCode");
    expect(nur).toContain("itemNumber");
  });

  it("eine Mahnung meldet nur, was auf Mahnungen wirkt", () => {
    const gemeldet = ungenutzteGestaltung("", "mahnung");
    expect(gemeldet).toContain("giroCode");
    expect(gemeldet).not.toContain("itemNumber");
    expect(gemeldet).not.toContain("vatColumn");
  });
});

const eingebaut: LayoutJeBeleg = { rechnung: null, angebot: null, auftragsbestaetigung: null, lieferschein: null, mahnung: null };

describe("Hinweise in der Beleggestaltung", () => {
  it("ohne eigene Layouts gibt es keine", () => {
    expect(gestaltungsHinweise(eingebaut)).toEqual({});
  });

  it("aus, wenn kein Beleg, auf den die Einstellung wirkt, sie zeigt", () => {
    const hinweise = gestaltungsHinweise({
      ...eingebaut,
      rechnung: { name: "Schlicht", ungenutzt: ["giroCode"] },
      mahnung: { name: "Schlicht Mahnung", ungenutzt: ["giroCode"] },
    });
    expect(hinweise.giroCode).toEqual({ aus: true, text: "Die Layouts „Schlicht“ und „Schlicht Mahnung“ verwenden qr nicht." });
  });

  it("an, solange ein eingebautes Layout sie zeigt; der Hinweis nennt die Belegarten ohne", () => {
    const schlicht = { name: "Schlicht", ungenutzt: ["foldMarks", "giroCode"] as const };
    const hinweise = gestaltungsHinweise({ ...eingebaut, rechnung: schlicht, angebot: schlicht });
    expect(hinweise.foldMarks).toEqual({ aus: false, text: "Wirkt nicht auf Rechnungen und Angebote: Das Layout „Schlicht“ verwendet look.foldMarks nicht." });
    expect(hinweise.giroCode).toEqual({ aus: false, text: "Wirkt nicht auf Rechnungen: Das Layout „Schlicht“ verwendet qr nicht." });
  });

  it("zählt nur Belegarten, auf die die Einstellung wirkt", () => {
    // Die Spalte USt gibt es auf Lieferschein und Mahnung nicht; ein eigenes Layout dort ändert nichts daran
    const ohneSpalte = { name: "Ohne Spalte", ungenutzt: ["vatColumn"] as const };
    const hinweise = gestaltungsHinweise({ ...eingebaut, rechnung: ohneSpalte, angebot: ohneSpalte, auftragsbestaetigung: ohneSpalte });
    expect(hinweise.vatColumn?.aus).toBe(true);
    expect(hinweise.vatColumn?.text).toBe("Das Layout „Ohne Spalte“ verwendet hideVatColumn nicht.");
  });

  it("Akzentfarbe und Logo bleiben an, auch wenn alle fünf Belegarten ein eigenes Layout ohne sie haben: Entgeltabrechnung und Steuerbescheinigung verwenden sie", () => {
    // Beide setzt immer das eingebaute Layout (templates/lohnabrechnung.typ, steuerbescheinigung.typ) mit d.accent und d.logo
    const ohneMarke = { name: "Ohne Marke", ungenutzt: ["accent", "logo"] as const };
    const hinweise = gestaltungsHinweise({
      rechnung: ohneMarke,
      angebot: ohneMarke,
      auftragsbestaetigung: ohneMarke,
      lieferschein: ohneMarke,
      mahnung: ohneMarke,
    });
    expect(hinweise.accent?.aus).toBe(false);
    expect(hinweise.logo?.aus).toBe(false);
  });

  it("mehrere Felder: weder … noch", () => {
    const hinweise = gestaltungsHinweise({ ...eingebaut, mahnung: { name: "Grau", ungenutzt: ["accent"] } });
    expect(hinweise.accent?.text).toBe("Wirkt nicht auf Mahnungen: Das Layout „Grau“ verwendet weder accent noch palette.");
  });
});
