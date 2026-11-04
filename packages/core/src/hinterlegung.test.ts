import { describe, expect, it } from "vitest";
import { abschluss } from "./hgb.ts";
import { FEHLBETRAG_LABEL, feststellungFehler, hinterlegungBilanz, hinterlegungFrist, hinterlegungMaengel, type HinterlegungFirma } from "./hinterlegung.ts";
import type { Kontenrahmen } from "./posting.ts";

const FIRMA: HinterlegungFirma = { name: "Nordlicht Software GmbH", sitz: "Bremen", registergericht: "Amtsgericht Bremen", registernummer: "HRB 12345 HB" };
const KEINE = { haftungsverhaeltnisse: "", organkredite: "", festgestelltAm: "2026-06-30" };

/** Konten je Kontenrahmen: Bank, Gezeichnetes Kapital, Gewinnvortrag, Erlöse, sonstiger Aufwand, Verbindlichkeit */
const KONTEN = {
  SKR03: { bank: "1200", kapital: "0800", vortrag: "0860", erloese: "8400", aufwand: "4930", verbindlichkeit: "1600" },
  SKR04: { bank: "1800", kapital: "2900", vortrag: "2970", erloese: "4400", aufwand: "6815", verbindlichkeit: "3300" },
} as const;

describe.each(["SKR03", "SKR04"] as const)("Bilanz zur Hinterlegung (§ 326 Abs. 2 HGB), %s", (kr: Kontenrahmen) => {
  const k = KONTEN[kr];
  // Vorjahr: 25.000 € Stammkapital und 3.000 € Gewinnvortrag auf der Bank
  const vorjahr = abschluss(kr, [
    { account: k.bank, saldo: 2_800_000 },
    { account: k.kapital, saldo: -2_500_000 },
    { account: k.vortrag, saldo: -300_000 },
  ]);
  // Jahr: 10.000 € Erlöse, 4.000 € Aufwand, davon 1.000 € noch offen; auf der Bank 28.000 + 10.000 − 3.000
  const jahr = abschluss(kr, [
    { account: k.bank, saldo: 3_500_000 },
    { account: k.kapital, saldo: -2_500_000 },
    { account: k.vortrag, saldo: -300_000 },
    { account: k.erloese, saldo: -1_000_000 },
    { account: k.aufwand, saldo: 400_000 },
    { account: k.verbindlichkeit, saldo: -100_000 },
  ]);

  it("Posten mit Vorjahr, Summen, Angaben „Keine.“ und Feststellung", () => {
    const bilanz = hinterlegungBilanz({ year: 2025, firma: FIRMA, report: jahr, vorjahr, angaben: KEINE });
    expect(bilanz.stichtag).toBe("2025-12-31");
    expect(bilanz.vorjahresstichtag).toBe("2024-12-31");
    expect(bilanz.aktiva).toEqual([{ label: "B. Umlaufvermögen", betrag: 3_500_000, vorjahr: 2_800_000 }]);
    expect(bilanz.passiva).toEqual([
      { label: "A. Eigenkapital", betrag: 3_400_000, vorjahr: 2_800_000 },
      { label: "C. Verbindlichkeiten", betrag: 100_000, vorjahr: 0 },
    ]);
    expect(bilanz.summeAktiva).toEqual({ label: "Summe Aktiva", betrag: 3_500_000, vorjahr: 2_800_000 });
    expect(bilanz.summePassiva).toEqual({ label: "Summe Passiva", betrag: 3_500_000, vorjahr: 2_800_000 });
    expect(bilanz.angaben.map((a) => a.text)).toEqual(["Keine.", "Keine."]);
    expect(bilanz.angaben[0]!.titel).toContain("§ 268 Abs. 7");
    expect(bilanz.angaben[1]!.titel).toContain("§ 285 Nr. 9 Buchst. c");
    expect(bilanz.feststellung).toBe("2026-06-30");
    expect(hinterlegungMaengel(FIRMA, jahr, vorjahr)).toEqual([]);
  });

  it("übernimmt eingegebene Angaben unter der Bilanz wörtlich", () => {
    const bilanz = hinterlegungBilanz({
      year: 2025,
      firma: FIRMA,
      report: jahr,
      vorjahr,
      angaben: { ...KEINE, haftungsverhaeltnisse: " Bürgschaft für die Muster KG: 5.000 € ", organkredite: "Darlehen an die Geschäftsführerin: 2.000 €, 3 % Zinsen" },
    });
    expect(bilanz.angaben.map((a) => a.text)).toEqual(["Bürgschaft für die Muster KG: 5.000 €", "Darlehen an die Geschäftsführerin: 2.000 €, 3 % Zinsen"]);
  });

  it("im ersten Geschäftsjahr ohne Vorjahresspalte", () => {
    const bilanz = hinterlegungBilanz({ year: 2025, firma: FIRMA, report: jahr, vorjahr: null, angaben: KEINE });
    expect(bilanz.vorjahresstichtag).toBeNull();
    expect(bilanz.aktiva.every((z) => z.vorjahr === null)).toBe(true);
    expect(bilanz.summePassiva.vorjahr).toBeNull();
  });

  it("aufgebrauchtes Eigenkapital als Fehlbetrag am Schluss der Aktivseite (§ 268 Abs. 3 HGB)", () => {
    const verlust = abschluss(kr, [
      { account: k.bank, saldo: 100_000 },
      { account: k.kapital, saldo: -2_500_000 },
      { account: k.aufwand, saldo: 3_000_000 },
      { account: k.verbindlichkeit, saldo: -600_000 },
    ]);
    const bilanz = hinterlegungBilanz({ year: 2025, firma: FIRMA, report: verlust, vorjahr: null, angaben: KEINE });
    expect(bilanz.aktiva.at(-1)).toEqual({ label: FEHLBETRAG_LABEL, betrag: 500_000, vorjahr: null });
    expect(bilanz.passiva[0]).toEqual({ label: "A. Eigenkapital", betrag: 0, vorjahr: null });
    expect(bilanz.summeAktiva.betrag).toBe(600_000);
    expect(bilanz.summePassiva.betrag).toBe(600_000);
  });

  it("meldet fehlende Registerangaben und eine Bilanz, die nicht aufgeht", () => {
    const schief = abschluss(kr, [{ account: k.bank, saldo: 100_000 }]);
    expect(hinterlegungMaengel({ ...FIRMA, sitz: " ", registergericht: "", registernummer: "" }, schief, null)).toEqual([
      "Der Sitz der Gesellschaft fehlt in den Firmendaten.",
      "Das Registergericht fehlt in den Firmendaten.",
      "Die Handelsregisternummer fehlt in den Firmendaten.",
      "Aktiva und Passiva sind nicht gleich; erst die offenen Punkte des Abschlusses klären.",
    ]);
    expect(hinterlegungMaengel(FIRMA, jahr, schief)).toEqual(["Aktiva und Passiva des Vorjahres sind nicht gleich; die Eröffnung ist unvollständig."]);
  });
});

describe("Frist und Feststellung", () => {
  it("Frist: ein Jahr nach dem Stichtag (§ 325 Abs. 1a HGB)", () => {
    expect(hinterlegungFrist(2025)).toBe("2026-12-31");
  });

  it("Feststellung nach dem Stichtag und nicht in der Zukunft", () => {
    expect(feststellungFehler(2025, "2025-12-31", "2026-11-04")).toContain("nach dem Bilanzstichtag");
    expect(feststellungFehler(2025, "2026-11-05", "2026-11-04")).toContain("in der Zukunft");
    expect(feststellungFehler(2025, "2026-06-30", "2026-11-04")).toBeNull();
  });
});
