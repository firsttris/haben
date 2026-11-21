import { join } from "node:path";
import { EINGEBAUTE_LAYOUTS, type EingebautesLayout, eingebautesLayout, layoutVorlagen, wertErlaubt } from "@haben/core";
import { describe, expect, it } from "vitest";
import { BEISPIEL_PNG, layoutBeispiele } from "./layout-beispiele.ts";
import { ungenutzteGestaltung } from "./layout-gestaltung.ts";
import { ungenutztePflichtfelder } from "./layout-pflicht.ts";
import { eingebautesLayoutAlsDatei } from "./layout-startvorlage.ts";
import { compileWith, getCompiler, PACKAGE_DIR } from "./typst-compiler.ts";

const templates = join(PACKAGE_DIR, "templates");

/** Jede Kombination, die die Gestaltung anbieten kann */
function varianten(layout: EingebautesLayout): Record<string, string>[] {
  let kombinationen: Record<string, string>[] = [{}];
  for (const option of layout.optionen) {
    kombinationen = kombinationen.flatMap((bisher) => {
      const erlaubt = option.werte.filter((wert) => wertErlaubt(wert, bisher));
      // Eine Option ohne erlaubten Wert gilt nicht (Kerndaten bei Klar in der Fassung „Klassisch“)
      return erlaubt.length === 0 ? [bisher] : erlaubt.map((wert) => ({ ...bisher, [option.id]: wert.id }));
    });
  }
  return kombinationen;
}

const faelle = EINGEBAUTE_LAYOUTS.flatMap((layout) =>
  varianten(layout).flatMap((optionen) =>
    (["beleg", "mahnung"] as const).map((art) => [`${layout.id} ${art} ${JSON.stringify(optionen)}`, layout, optionen, art] as const),
  ),
);

/**
 * Setzt eine Vorlage im Ordner templates/: eine heruntergeladene Datei liegt dort nur im Speicher, damit logo.png und
 * briefpapier.png gleich aufgelöst werden
 */
function setzen(datei: { name: string; inhalt?: string }, data: object): Uint8Array {
  const typst = getCompiler();
  const pfad = join(templates, datei.name);
  const bilder = ["logo.png", "briefpapier.png"].map((name) => join(templates, name));
  for (const bild of bilder) typst.mapShadow(bild, Buffer.from(BEISPIEL_PNG));
  if (datei.inhalt !== undefined) typst.mapShadow(pfad, Buffer.from(datei.inhalt));
  try {
    return compileWith(typst, pfad, data, "2026-10-02", "Probe");
  } finally {
    for (const bild of bilder) typst.unmapShadow(bild);
    if (datei.inhalt !== undefined) typst.unmapShadow(pfad);
  }
}

const mitOptionen = (data: object, options: Record<string, string>) => {
  const d = data as { look: object };
  return { ...d, look: { ...d.look, options } };
};

describe("Eingebautes Layout je Variante herunterladen", () => {
  it.each(faelle)(
    "%s: setzt als eigenes Layout (look.options leer) dasselbe wie das eingebaute",
    (_name, layout, optionen, art) => {
      const { inhalt } = eingebautesLayoutAlsDatei(layout, optionen, art);
      expect(inhalt).not.toMatch(/^#import /m);
      expect(ungenutztePflichtfelder(inhalt, art)).toEqual([]);
      expect(ungenutzteGestaltung(inhalt, art)).toEqual([]);
      const vorlage = layoutVorlagen(layout, optionen)[art];
      for (const beispiel of layoutBeispiele().filter((b) => b.art === art)) {
        const eingebaut = setzen({ name: vorlage }, mitOptionen(beispiel.data, optionen));
        const eigen = setzen({ name: "heruntergeladen.typ", inhalt }, mitOptionen(beispiel.data, {}));
        expect(Buffer.from(eigen).equals(Buffer.from(eingebaut)), beispiel.name).toBe(true);
      }
    },
    60_000,
  );

  it("die Variante steht fest in der Datei; ohne sie setzte ein eigenes Layout die erste", () => {
    const strukturiert = eingebautesLayout("strukturiert")!;
    const beispiel = layoutBeispiele().find((b) => b.name === "Rechnung")!;
    const kasten = eingebautesLayoutAlsDatei(strukturiert, { infoblock: "kasten" }, "beleg");
    const gitter = eingebautesLayoutAlsDatei(strukturiert, { infoblock: "gitter" }, "beleg");
    expect(kasten.inhalt).toContain('#let optionen = (infoblock: "kasten")');
    const leer = mitOptionen(beispiel.data, {});
    expect(
      Buffer.from(setzen({ name: "a.typ", inhalt: kasten.inhalt }, leer)).equals(Buffer.from(setzen({ name: "b.typ", inhalt: gitter.inhalt }, leer))),
    ).toBe(false);
  });

  it("benennt die Datei nach Layout, Variante und Art; gesperrte Werte löst sie auf wie die Gestaltung", () => {
    const atelier = eingebautesLayout("atelier")!;
    expect(eingebautesLayoutAlsDatei(atelier, { fuss: "unten", kerndaten: "zweispaltig" }, "mahnung").dateiname).toBe("atelier-unten-zweispaltig-mahnung.typ");
    // Zweispaltig nur mit dem Fuß unten
    const rechts = eingebautesLayoutAlsDatei(atelier, { fuss: "rechts", kerndaten: "zweispaltig" }, "beleg");
    expect(rechts.dateiname).toBe("atelier-rechts-liste-beleg.typ");
    expect(rechts.inhalt).toContain("(Fuß: In der Randspalte, Kerndaten: Liste)");
    expect(eingebautesLayoutAlsDatei(eingebautesLayout("klar")!, { fassung: "klassisch" }, "beleg").dateiname).toBe("klar-klassisch-beleg.typ");
  });
});
