import { unitLabelIssues } from "@haben/core";
import { describe, expect, it } from "vitest";
import { EINHEITENCODES } from "./codelisten.ts";
import { TEXTS } from "./i18n.ts";
import { sampleDocument } from "./samples.ts";
import { validateForFormat } from "./validate.ts";
import { buildEInvoice } from "./xml.ts";

/* Eigene Mengeneinheiten (#748) in der E-Rechnung: Code aus der Position (BT-130), geprüft gegen UN/ECE Rec. 20/21 (BR-CL-23) */
describe("Eigene Einheiten in der E-Rechnung", () => {
  const eigene = (unit: string, unitCode?: string) => {
    const doc = sampleDocument({ format: "xrechnung-ubl" });
    return { ...doc, lines: doc.lines.map((line) => ({ ...line, unit, ...(unitCode ? { unitCode } : {}) })) };
  };

  it("kennt die Codeliste der EN 16931 samt der festen Einheiten", () => {
    expect(EINHEITENCODES.size).toBeGreaterThan(2000);
    for (const code of ["HUR", "DAY", "MON", "H87", "LS", "KMT", "MTK", "LM", "C62", "E48"]) expect(EINHEITENCODES.has(code)).toBe(true);
    expect(EINHEITENCODES.has("QM")).toBe(false);
  });

  it("schreibt den Code der eigenen Einheit, die Bezeichnung bleibt auf dem Blatt", async () => {
    const { xml } = await buildEInvoice(eigene("UE", "C62"));
    expect(xml).toContain('unitCode="C62"');
    expect(TEXTS.de.quantity(2000, "UE")).toBe("2 UE");
    expect(TEXTS.en.quantity(2000, "UE")).toBe("2 UE");
  });

  it("feste Einheiten brauchen keinen Code in der Position", async () => {
    expect(validateForFormat(sampleDocument())).toEqual([]);
    expect((await buildEInvoice(sampleDocument({ format: "xrechnung-ubl" }))).xml).toMatch(/unitCode="(HUR|H87|LS|DAY|MON|KMT)"/);
  });

  it("meldet eine Einheit ohne Code oder mit einem Code außerhalb der Liste", () => {
    expect(validateForFormat(eigene("UE"))).toContainEqual(expect.stringContaining("Einheit „UE“"));
    expect(validateForFormat(eigene("qm", "QM"))).toContainEqual(expect.stringContaining("„QM“"));
  });

  // Review: Eine Bezeichnung wie eine geerbte Eigenschaft von Object darf die Übersetzung nicht treffen
  it("zeigt eine eigene Einheit, die wie eine Methode von Object heißt, auf englischen Belegen wie angelegt", async () => {
    for (const label of ["valueOf", "toString"]) {
      expect(unitLabelIssues(label, [])).toEqual([]);
      expect(TEXTS.en.quantity(2000, label)).toBe(`2 ${label}`);
    }
    const doc = sampleDocument({ format: "zugferd" });
    const en = { ...doc, language: "en" as const, lines: doc.lines.map((line) => ({ ...line, unit: "valueOf", unitCode: "C62" })) };
    await expect(buildEInvoice(en)).resolves.toMatchObject({ xml: expect.stringContaining('unitCode="C62"') });
  });
});
