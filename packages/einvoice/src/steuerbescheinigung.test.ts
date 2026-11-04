import { ausschuettungAnteil, steuerbescheinigung, type Steuerbescheinigung } from "@haben/core";
import { describe, expect, it } from "vitest";
import { buildSteuerbescheinigungPdf, steuerbescheinigungPdfData } from "./steuerbescheinigung.ts";

function bescheinigung(kirchensteuer: 0 | 9): Steuerbescheinigung {
  const anteil = ausschuettungAnteil({ brutto: 1_000_000, ausEinlagekonto: 200_000, kirchensteuer });
  const r = steuerbescheinigung({
    aussteller: { name: "Nordlicht Software GmbH", strasse: "Hafenallee 3", plz: "28217", ort: "Bremen", steuernummer: "60/145/12345" },
    glaeubiger: { name: "Erika Muster", strasse: "Lindenweg 1", plzOrt: "28195 Bremen", idnr: "86095742719" },
    anteil: { ...anteil, religionsschluessel: kirchensteuer ? "026300" : null },
    zahlungstag: "2026-05-05",
    ausstellungstag: "2026-05-06",
  });
  if (!r.ok) throw new Error(r.fehlend.join(" "));
  return r.bescheinigung;
}

describe("Steuerbescheinigung als PDF", () => {
  it("Gläubiger im Anschriftfeld, Zeilen formatiert, Zahlungstag", () => {
    const data = steuerbescheinigungPdfData({ bescheinigung: bescheinigung(0) });
    expect(data.recipient).toEqual(["Erika Muster", "Lindenweg 1", "28195 Bremen"]);
    expect(data.meta).toContainEqual({ label: "Zahlungstag", value: "05.05.2026" });
    expect(data.parties).toContainEqual({ label: "Identifikationsnummer", value: "86095742719" });
    expect(data.rows[0]).toEqual({ label: "Höhe der Kapitalerträge", value: "8.000,00 €" });
    expect(data.rows.at(-1)).toEqual({ label: "Leistungen aus dem steuerlichen Einlagekonto (§ 27 Abs. 1 bis 7 KStG)", value: "2.000,00 €" });
    expect(data.notes.join(" ")).not.toContain("Religionsschlüssel");
  });

  it("nennt mit Kirchensteuer den Religionsschlüssel", () => {
    expect(steuerbescheinigungPdfData({ bescheinigung: bescheinigung(9) }).notes[0]).toContain("026300");
  });

  it("erzeugt ein PDF/A-3b", () => {
    const pdf = buildSteuerbescheinigungPdf({ bescheinigung: bescheinigung(9) });
    const text = Buffer.from(pdf).toString("latin1");
    expect(text.slice(0, 5)).toBe("%PDF-");
    expect(text).toContain("<pdfaid:part>3</pdfaid:part>");
  });
});
