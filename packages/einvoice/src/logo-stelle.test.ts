import { DEFAULT_OPTIONS, EINGEBAUTE_LAYOUTS, layoutLogo, layoutOptionen, type LogoPosition } from "@haben/core";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dunningPdfData } from "./dunning.ts";
import { BEISPIEL_PNG } from "./layout-beispiele.ts";
import { layoutTemplate, pdfData, templateInputs } from "./pdf.ts";
import { createRenderClient } from "./render-client.ts";
import { sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";
import { PACKAGE_DIR } from "./typst-compiler.ts";

/* Stelle des Logos auf dem Blatt (#113): „links“ am Satzspiegel (25 mm), „rechts“ bündig bei 190 mm, „mitte“ mittig auf dem Blatt */

const templates = join(PACKAGE_DIR, "templates");
const client = createRenderClient({ timeoutMs: 5_000 });
const MM = 72 / 25.4;

afterAll(() => client.close());

/** Linke Kante und Mitte des ersten Bildes im SVG in mm, aus den verschachtelten translate() der Gruppen */
function bildX(svg: string): { links: number; mitte: number } {
  const stapel: number[] = [];
  for (const [tag] of svg.matchAll(/<\/g>|<g\b[^>]*>|<image\b[^>]*>/g)) {
    if (tag === "</g>") stapel.pop();
    else if (tag.startsWith("<g")) {
      if (!tag.endsWith("/>")) stapel.push(Number(/translate\(([-\d.]+)/.exec(tag)?.[1] ?? 0));
    } else {
      const links = stapel.reduce((summe, x) => summe + x, 0);
      const breite = Number(/width="([\d.]+)"/.exec(tag)?.[1]);
      return { links: links / MM, mitte: (links + breite / 2) / MM };
    }
  }
  throw new Error("kein Bild im SVG");
}

type Layout = { id: string; optionen: Record<string, string> };

async function logo(vorlage: "rechnung" | "mahnung", data: object, logoPosition: LogoPosition, layout?: Layout) {
  const letterhead = { logo: { data: BEISPIEL_PNG, format: "png" as const }, options: { ...DEFAULT_OPTIONS, logoPosition }, layout };
  const datei = layout ? layoutTemplate(vorlage === "rechnung" ? "beleg" : "mahnung", letterhead) : `${vorlage}.typ`;
  const job = {
    workspace: templates,
    main: join(templates, datei),
    data: templateInputs(data, letterhead),
    files: [{ name: "logo.png", base64: Buffer.from(BEISPIEL_PNG).toString("base64") }],
  };
  return bildX((await client.render(job)).svg);
}

const mahnung = dunningPdfData({
  level: 1,
  date: "2026-10-15",
  dueDate: "2026-10-25",
  seller: sampleSeller,
  buyer: sampleBuyer,
  invoice: { number: "2026-001", issueDate: "2026-09-01", dueDate: "2026-09-15" },
  amounts: { open: 119_000, fee: 0, flatFee: 0, interest: 0, interestRate: 0, interestDays: 0, total: 119_000 },
  intro: "Bitte zahlen.",
  closing: "",
});

describe("Stelle des Logos auf dem Blatt", () => {
  for (const [vorlage, data] of [
    ["rechnung", pdfData(sampleDocument())],
    ["mahnung", mahnung],
  ] as const) {
    it(`${vorlage}.typ setzt „mitte“ auf die Mitte des Blatts (105 mm), nicht des Satzspiegels`, async () => {
      expect((await logo(vorlage, data, "links")).links).toBeCloseTo(25, 1);
      expect((await logo(vorlage, data, "mitte")).mitte).toBeCloseTo(105, 1);
      const rechts = await logo(vorlage, data, "rechts");
      expect(rechts.links + (rechts.mitte - rechts.links) * 2).toBeCloseTo(190, 1);
    });
  }
});

/** Je eingebautes Layout die Fassungen, die eine eigene Vorlage wählen: erste Werte und jeder Wert der ersten Option */
const fassungen = EINGEBAUTE_LAYOUTS.flatMap((layout) => {
  const erste = layout.optionen[0];
  const werte = erste ? erste.werte.map((wert) => layoutOptionen(layout, { [erste.id]: wert.id })) : [layoutOptionen(layout)];
  return werte.map((optionen) => ({ id: layout.id, optionen, stellen: layoutLogo(layout, optionen) }));
});

describe("Stelle des Logos in den eingebauten Layouts", () => {
  for (const { id, optionen, stellen } of fassungen) {
    for (const [vorlage, data] of [
      ["rechnung", pdfData(sampleDocument())],
      ["mahnung", mahnung],
    ] as const) {
      it.runIf(stellen.includes("mitte"))(`${id} ${JSON.stringify(optionen)} (${vorlage}) setzt „mitte“ auf 105 mm`, async () => {
        expect((await logo(vorlage, data, "mitte", { id, optionen })).mitte).toBeCloseTo(105, 1);
      });
      it.runIf(stellen.includes("links"))(`${id} ${JSON.stringify(optionen)} (${vorlage}) setzt „links“ an den Satzspiegel`, async () => {
        expect((await logo(vorlage, data, "links", { id, optionen })).links).toBeLessThan(40);
      });
    }
  }
});
