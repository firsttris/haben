import { describe, expect, it } from "vitest";
import { LETTERHEAD_FONTS } from "./letterhead-design.ts";
import {
  bekannteLayoutOptionen,
  EINGEBAUTE_LAYOUTS,
  type EingebautesLayout,
  layoutLogo,
  layoutOptionen,
  layoutVorgaben,
  layoutVorlagen,
  logoStelle,
  MAX_LAYOUT_OPTIONEN,
  optionenZurWahl,
  STANDARD_LAYOUT_ID,
  wertErlaubt,
} from "./layout-katalog.ts";

const atelier = EINGEBAUTE_LAYOUTS.find((layout) => layout.id === "atelier") as EingebautesLayout;
const elegant = EINGEBAUTE_LAYOUTS.find((layout) => layout.id === "elegant") as EingebautesLayout;

/** Alle Kombinationen, die die Gestaltung anbieten kann: je Option nur erlaubte Werte */
function kombinationen(layout: EingebautesLayout): Record<string, string>[] {
  let ergebnis: Record<string, string>[] = [{}];
  for (const option of layout.optionen) {
    ergebnis = ergebnis.flatMap((bisher) => {
      const erlaubt = option.werte.filter((wert) => wertErlaubt(wert, bisher));
      // Ohne erlaubten Wert gilt die Option nicht
      return erlaubt.length === 0 ? [bisher] : erlaubt.map((wert) => ({ ...bisher, [option.id]: wert.id }));
    });
  }
  return ergebnis;
}

describe("Katalog der eingebauten Layouts", () => {
  it("hat eindeutige IDs und das Standardlayout vorn", () => {
    const ids = EINGEBAUTE_LAYOUTS.map((layout) => layout.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(STANDARD_LAYOUT_ID);
  });

  it.each(EINGEBAUTE_LAYOUTS.map((layout) => [layout.id, layout] as const))("%s hält die Regeln für Optionen ein", (_id, layout) => {
    expect(layout.optionen.length).toBeLessThanOrEqual(MAX_LAYOUT_OPTIONEN);
    expect(layout.vorgaben.font in LETTERHEAD_FONTS).toBe(true);
    expect(layout.vorgaben.accent).toMatch(/^#[0-9A-F]{6}$/i);
    const frueher = new Set<string>();
    for (const option of layout.optionen) {
      expect(new Set(option.werte.map((wert) => wert.id)).size).toBe(option.werte.length);
      for (const wert of option.werte) {
        if (wert.vorgaben?.font) expect(wert.vorgaben.font in LETTERHEAD_FONTS).toBe(true);
        // Ein Wert hängt nur von Optionen davor ab, nie von späteren: so gibt es keinen Kreis
        for (const [abhaengig, erlaubt] of Object.entries(wert.wenn ?? {})) {
          expect(frueher.has(abhaengig), `${layout.id}.${option.id}.${wert.id} hängt von ${abhaengig} ab`).toBe(true);
          const quelle = layout.optionen.find((o) => o.id === abhaengig);
          for (const id of erlaubt) expect(quelle?.werte.some((w) => w.id === id)).toBe(true);
        }
      }
      frueher.add(option.id);
    }
    // Die ersten Werte aller Optionen sind zusammen erlaubt, und jede Kombination, die die Gestaltung anbietet, bleibt so
    const ersteWerte = Object.fromEntries(layout.optionen.map((option) => [option.id, option.werte[0]?.id ?? ""]));
    expect(layoutOptionen(layout, ersteWerte)).toEqual(ersteWerte);
    for (const kombination of kombinationen(layout)) expect(layoutOptionen(layout, kombination)).toEqual(kombination);
  });

  it("setzt Klar in der Fassung „Klassisch“ mit dem bisherigen Layout und seiner Schrift, ohne Kerndaten", () => {
    const klar = EINGEBAUTE_LAYOUTS.find((layout) => layout.id === "klar") as EingebautesLayout;
    const klassisch = layoutOptionen(klar, { fassung: "klassisch", kerndaten: "karte" });
    expect(klassisch).toEqual({ fassung: "klassisch" });
    expect(layoutVorlagen(klar, klassisch)).toEqual({ beleg: "rechnung.typ", mahnung: "mahnung.typ" });
    expect(layoutVorgaben(klar, klassisch)).toEqual({ font: "plex-sans", accent: klar.vorgaben.accent });
    expect(layoutVorgaben(klar, layoutOptionen(klar)).font).toBe("inter");
    expect(layoutVorlagen(klar, layoutOptionen(klar, { kerndaten: "karte" })).beleg).toBe("layout-klar-karte.typ");
    expect(layoutVorlagen(klar, layoutOptionen(klar)).mahnung).toBe("layout-klar-mahnung.typ");
  });

  it("löst gesperrte Werte zum ersten erlaubten auf und lässt unbekannte weg", () => {
    expect(layoutOptionen(atelier, { fuss: "rechts", kerndaten: "zweispaltig", unbekannt: "x" })).toEqual({ fuss: "rechts", kerndaten: "liste" });
    expect(layoutOptionen(atelier, { fuss: "unten", kerndaten: "zweispaltig" })).toEqual({ fuss: "unten", kerndaten: "zweispaltig" });
    expect(layoutOptionen(atelier, { fuss: "oben" })).toEqual({ fuss: "unten", kerndaten: "liste" });
  });

  it("wählt die Vorlage nach dem Fuß und beschränkt das Logo in der Randspalte", () => {
    expect(layoutVorlagen(atelier, { fuss: "rechts" }).beleg).toBe("layout-atelier-rechts.typ");
    expect(layoutVorlagen(atelier, { fuss: "unten" }).mahnung).toBe("layout-atelier-unten-mahnung.typ");
    expect(layoutLogo(atelier, { fuss: "rechts" })).toEqual(["rechts", "links", "mitte"]);
    expect(layoutLogo(elegant, { fuss: "rechts" })).toEqual(["rechts", "links"]);
    expect(logoStelle(elegant, { fuss: "rechts" }, "mitte")).toBe("rechts");
    expect(logoStelle(elegant, { fuss: "unten" }, "mitte")).toBe("mitte");
  });

  it("behält von der gespeicherten Wahl nur Bekanntes, auch gesperrte Werte", () => {
    expect(
      bekannteLayoutOptionen({
        atelier: { fuss: "rechts", kerndaten: "zweispaltig", farbe: "rot" },
        klar: { x: "y" },
        fremd: { fuss: "unten" },
        modern: { akzent: "bunt" },
      }),
    ).toEqual({ atelier: { fuss: "rechts", kerndaten: "zweispaltig" }, klar: {}, modern: {} });
  });

  it("bietet der Gestaltung je Option den aufgelösten Wert und graut gesperrte Werte aus", () => {
    const wahl = optionenZurWahl(atelier, { fuss: "rechts", kerndaten: "zweispaltig" });
    expect(wahl.map((option) => [option.id, option.wert])).toEqual([
      ["fuss", "rechts"],
      ["kerndaten", "liste"],
    ]);
    expect(wahl[1]!.werte).toEqual([
      { id: "liste", name: "Liste", erlaubt: true },
      { id: "zweispaltig", name: "Zweispaltig", erlaubt: false },
    ]);
    expect(optionenZurWahl(atelier, { fuss: "unten" })[1]!.werte.every((wert) => wert.erlaubt)).toBe(true);
  });
});
