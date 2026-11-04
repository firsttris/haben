import { abschluss, hinterlegungBilanz, type Kontenrahmen } from "@haben/core";
import { describe, expect, it } from "vitest";
import { buildHinterlegungPdf, hinterlegungPdfData } from "./hinterlegung.ts";

const FIRMA = { name: "Nordlicht Software GmbH", sitz: "Bremen", registergericht: "Amtsgericht Bremen", registernummer: "HRB 12345 HB" };
const ANGABEN = { haftungsverhaeltnisse: "", organkredite: "", festgestelltAm: "2026-06-30" };
const KONTEN = { SKR03: { bank: "1200", kapital: "0800" }, SKR04: { bank: "1800", kapital: "2900" } } as const;

function bilanz(kr: Kontenrahmen, mitVorjahr: boolean) {
  const { bank, kapital } = KONTEN[kr];
  const report = abschluss(kr, [
    { account: bank, saldo: 2_500_000 },
    { account: kapital, saldo: -2_500_000 },
  ]);
  return hinterlegungBilanz({ year: 2025, firma: FIRMA, report, vorjahr: mitVorjahr ? report : null, angaben: ANGABEN });
}

describe.each(["SKR03", "SKR04"] as const)("PDF zur Hinterlegung, %s", (kr) => {
  it("Kopf mit Registerangaben, Spalten mit Stichtag, Beträge ohne Währungszeichen", () => {
    const data = hinterlegungPdfData(bilanz(kr, true));
    expect(data.firma).toBe("Nordlicht Software GmbH");
    expect(data.kopf).toEqual(["Sitz: Bremen", "Registergericht: Amtsgericht Bremen, HRB 12345 HB"]);
    expect(data.title).toBe("Bilanz zum 31.12.2025");
    expect(data.spalten).toEqual({ jahr: "31.12.2025", vorjahr: "31.12.2024" });
    expect(data.aktiva).toEqual([{ label: "B. Umlaufvermögen", betrag: "25.000,00", vorjahr: "25.000,00" }]);
    expect(data.summePassiva).toEqual({ label: "Summe Passiva", betrag: "25.000,00", vorjahr: "25.000,00" });
    expect(data.angaben.map((a) => a.text)).toEqual(["Keine.", "Keine."]);
    expect(data.feststellung).toBe("Der Jahresabschluss wurde am 30.06.2026 festgestellt.");
  });

  it("erzeugt ein PDF, mit und ohne Vorjahr", () => {
    for (const mitVorjahr of [true, false]) {
      const pdf = buildHinterlegungPdf(bilanz(kr, mitVorjahr), "2026-11-04");
      expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    }
    expect(hinterlegungPdfData(bilanz(kr, false)).spalten.vorjahr).toBeNull();
  });
});
