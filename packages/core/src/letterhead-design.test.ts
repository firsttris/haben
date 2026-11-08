import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN,
  DEFAULT_LAYOUT,
  designWithDefaults,
  LAYOUT_DOCUMENT_TYPES,
  LETTERHEAD_FONTS,
  letterheadDesignInputSchema,
  LOGO_SIZES,
  showsVatColumn,
} from "./letterhead-design.ts";

describe("Gestaltung der Belege", () => {
  it("jede Belegart hat ab Werk das eingebaute Layout", () => {
    for (const type of LAYOUT_DOCUMENT_TYPES) expect(DEFAULT_DESIGN.layouts[type]).toEqual(DEFAULT_LAYOUT);
  });

  it("ergänzt fehlende Einstellungen und behält gespeicherte", () => {
    const design = designWithDefaults({ accent: "#0055AA", layouts: { ...DEFAULT_DESIGN.layouts, mahnung: { kind: "eingebaut", id: "anders" } } });
    expect(design).toMatchObject({ accent: "#0055AA", logoSize: "m", foldMarks: true });
    expect(design.layouts.mahnung.id).toBe("anders");
    expect(design.layouts.rechnung).toEqual(DEFAULT_LAYOUT);
    expect(designWithDefaults(null)).toEqual(DEFAULT_DESIGN);
  });

  it("nimmt der Spalte USt nur bei einem einzigen Steuersatz die Pflicht", () => {
    expect(showsVatColumn(false, 1)).toBe(false);
    expect(showsVatColumn(false, 0)).toBe(false);
    expect(showsVatColumn(false, 2)).toBe(true);
    expect(showsVatColumn(true, 1)).toBe(true);
  });

  it("das größte Logo endet über dem Anschriftfeld nach DIN 5008", () => {
    const seitenrand = 20;
    const anschriftfeld = 45;
    for (const { height } of Object.values(LOGO_SIZES)) expect(seitenrand + height).toBeLessThan(anschriftfeld);
  });

  it("prüft Eingaben und lässt Teiländerungen zu", () => {
    expect(letterheadDesignInputSchema.safeParse({ foldMarks: false }).success).toBe(true);
    expect(letterheadDesignInputSchema.safeParse({ accent: "rot" }).success).toBe(false);
    expect(letterheadDesignInputSchema.safeParse({ logoPosition: "mitte" }).success).toBe(false);
  });
});

describe("Schrift und Briefpapier in der Gestaltung", () => {
  it("nimmt ab Werk die bisherige Schrift und legt Briefpapier nur auf die erste Seite", () => {
    expect(DEFAULT_DESIGN.font).toBe("plex-sans");
    expect(DEFAULT_DESIGN.backgroundPages).toBe("erste");
  });

  it("ergänzt beides bei gespeicherten Profilen von früher", () => {
    expect(designWithDefaults({ accent: "#123456" })).toMatchObject({ font: "plex-sans", backgroundPages: "erste" });
  });

  it("nimmt nur Schriften aus der Auswahl an", () => {
    expect(letterheadDesignInputSchema.safeParse({ font: "plex-serif" }).success).toBe(true);
    expect(letterheadDesignInputSchema.safeParse({ font: "comic-sans" }).success).toBe(false);
  });

  it("kennt nur erste Seite oder alle Seiten", () => {
    expect(letterheadDesignInputSchema.safeParse({ backgroundPages: "alle" }).success).toBe(true);
    expect(letterheadDesignInputSchema.safeParse({ backgroundPages: "letzte" }).success).toBe(false);
  });

  it("nennt je Schrift die Familien für Normal, Medium und SemiBold", () => {
    for (const font of Object.values(LETTERHEAD_FONTS)) {
      expect(font.regular).toBeTruthy();
      expect(font.medium).toBeTruthy();
      expect(font.semibold).toBeTruthy();
    }
  });
});
