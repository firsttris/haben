import { describe, expect, it } from "vitest";
import {
  bilanzVermerke,
  ebilanzRestlaufzeiten,
  istGesellschafterKonto,
  restlaufzeitAbgleich,
  restlaufzeitLautKonto,
  restlaufzeitZeilen,
  VERMERK,
  vermerkKonten,
} from "./bilanzvermerke.ts";
import { abschluss } from "./hgb.ts";
import { hinterlegungBilanz } from "./hinterlegung.ts";
import type { Kontenrahmen } from "./posting.ts";

/*
 * Konten je Kontenrahmen (DATEV 2026): Bank, Kapital, Forderungen und Verbindlichkeiten aus Lieferungen und Leistungen,
 * Gesellschafter-Verrechnungskonto, Bankdarlehen mit Restlaufzeit 1 bis 5 Jahre und bis 1 Jahr, Umsatzsteuer 19 %,
 * Ausleihungen an GmbH-Gesellschafter, Forderungen gegen GmbH-Gesellschafter mit Restlaufzeit größer 1 Jahr.
 */
const K = {
  SKR03: {
    bank: "1200",
    kapital: "0800",
    forderungen: "1400",
    verbindlichkeiten: "1600",
    gesellschafter: "0730",
    darlehen: "0640",
    darlehenKurz: "0631",
    ust: "1776",
    ausleihung: "0582",
    forderungGes: "1383",
  },
  SKR04: {
    bank: "1800",
    kapital: "2900",
    forderungen: "1200",
    verbindlichkeiten: "3300",
    gesellschafter: "3510",
    darlehen: "3160",
    darlehenKurz: "3151",
    ust: "3806",
    ausleihung: "0961",
    forderungGes: "1309",
  },
} as const;

describe.each(["SKR03", "SKR04"] as const)("Bilanzvermerke %s", (kr: Kontenrahmen) => {
  const k = K[kr];
  // 25.000 Kapital; Bank 30.000; Forderungen 5.000; Ausleihung an den Gesellschafter 2.000; Forderung gegen ihn
  // mit Restlaufzeit > 1 Jahr 1.000; Verbindlichkeiten 1.500, Gesellschafter 4.000, Darlehen 6.000 + 1.200, USt 300
  const report = abschluss(kr, [
    { account: k.bank, saldo: 3_000_000 },
    { account: k.forderungen, saldo: 500_000 },
    { account: k.ausleihung, saldo: 200_000 },
    { account: k.forderungGes, saldo: 100_000 },
    { account: k.kapital, saldo: -2_500_000 },
    { account: k.verbindlichkeiten, saldo: -150_000 },
    { account: k.gesellschafter, saldo: -400_000 },
    { account: k.darlehen, saldo: -600_000 },
    { account: k.darlehenKurz, saldo: -120_000 },
    { account: k.ust, saldo: -30_000 },
  ]);

  it("Restlaufzeit und Gesellschafter laut DATEV-Kontenrahmen", () => {
    expect(restlaufzeitLautKonto(kr, k.darlehen)).toBe("ueber1");
    expect(restlaufzeitLautKonto(kr, k.darlehenKurz)).toBe("bis1");
    expect(restlaufzeitLautKonto(kr, k.forderungGes)).toBe("ueber1");
    expect(restlaufzeitLautKonto(kr, k.verbindlichkeiten)).toBeNull();
    for (const konto of [k.gesellschafter, k.ausleihung, k.forderungGes]) expect(istGesellschafterKonto(kr, konto), konto).toBe(true);
    for (const konto of [k.bank, k.forderungen, k.darlehen]) expect(istGesellschafterKonto(kr, konto), konto).toBe(false);
  });

  it("Konten mit Vermerk: ohne Bank, Ausleihungen nur an Gesellschafter", () => {
    const konten = vermerkKonten(kr, report);
    expect(konten.map((v) => v.account).sort()).toEqual(
      [k.ausleihung, k.forderungen, k.forderungGes, k.verbindlichkeiten, k.gesellschafter, k.darlehen, k.darlehenKurz, k.ust].sort(),
    );
    expect(konten.find((v) => v.account === k.gesellschafter)).toMatchObject({ posten: "passiva.C", betrag: 400_000, gesellschafter: true });
  });

  it("Vorschläge: fest laut Konto, Fälligkeit offener Posten, sonst sofort fällig", () => {
    const zeilen = restlaufzeitZeilen(kr, 2025, report, { forderungen: 0, verbindlichkeiten: 50_000 });
    const zeile = (account: string) => zeilen.find((z) => z.account === account)!;
    expect(zeile(k.darlehen)).toMatchObject({ eingabe: false, vorschlag: 600_000, art: "verbindlichkeit" });
    expect(zeile(k.darlehenKurz)).toMatchObject({ eingabe: false, vorschlag: 0 });
    expect(zeile(k.forderungGes)).toMatchObject({ eingabe: false, vorschlag: 100_000, art: "forderung" });
    expect(zeile(k.forderungen)).toMatchObject({ eingabe: true, vorschlag: 0 });
    expect(zeile(k.forderungen).grund).toContain("bis zum 31.12.2026 fällig");
    expect(zeile(k.verbindlichkeiten)).toMatchObject({ eingabe: true, vorschlag: 50_000 });
    expect(zeile(k.gesellschafter)).toMatchObject({ eingabe: true, vorschlag: 0 });
    expect(zeile(k.gesellschafter).grund).toContain("§ 271 Abs. 1 BGB");
    expect(zeilen.some((z) => z.account === k.ausleihung)).toBe(false);
  });

  it("Abgleich: fehlt, bestätigt, geändert", () => {
    const zeilen = restlaufzeitZeilen(kr, 2025, report, { forderungen: 0, verbindlichkeiten: 0 });
    expect(restlaufzeitAbgleich(zeilen, null).stand).toBe("fehlt");
    const angaben = zeilen
      .filter((z) => z.eingabe)
      .map((z) => ({ account: z.account, betrag: z.betrag, ueber1Jahr: z.account === k.gesellschafter ? 250_000 : 0 }));
    const ok = restlaufzeitAbgleich(zeilen, angaben);
    expect(ok.stand).toBe("bestaetigt");
    expect(ok.ueber1Jahr.get(k.gesellschafter)).toBe(250_000);
    expect(ok.ueber1Jahr.get(k.darlehen)).toBe(600_000);
    // Ein Betrag hat sich seit der Bestätigung geändert
    const anders = angaben.map((a) => (a.account === k.verbindlichkeiten ? { ...a, betrag: 1 } : a));
    expect(restlaufzeitAbgleich(zeilen, anders).stand).toBe("geaendert");
    // Mehr als der Betrag geht nicht
    const zuViel = angaben.map((a) => (a.account === k.gesellschafter ? { ...a, ueber1Jahr: 400_001 } : a));
    expect(restlaufzeitAbgleich(zeilen, zuViel).stand).toBe("geaendert");
    expect(restlaufzeitAbgleich([], null).stand).toBe("keine");
  });

  it("Vermerke: Restlaufzeiten nach § 268 Abs. 4 und 5 HGB, Gesellschafter nach § 42 Abs. 3 GmbHG", () => {
    const konten = vermerkKonten(kr, report);
    const zeilen = restlaufzeitZeilen(kr, 2025, report, { forderungen: 0, verbindlichkeiten: 0 });
    const angaben = zeilen
      .filter((z) => z.eingabe)
      .map((z) => ({ account: z.account, betrag: z.betrag, ueber1Jahr: z.account === k.gesellschafter ? 250_000 : 0 }));
    const { ueber1Jahr } = restlaufzeitAbgleich(zeilen, angaben);
    expect(bilanzVermerke(konten, ueber1Jahr)).toEqual([
      { posten: "aktiva.A", label: VERMERK.ausleihungenGesellschafter, betrag: 200_000 },
      { posten: "aktiva.B", label: VERMERK.forderungenUeber1Jahr, betrag: 100_000 },
      { posten: "aktiva.B", label: VERMERK.forderungenGesellschafter, betrag: 100_000 },
      // Verbindlichkeiten 13.000: über einem Jahr Darlehen 6.000 und 2.500 vom Gesellschafter
      { posten: "passiva.C", label: VERMERK.verbindlichkeitenBis1Jahr, betrag: 450_000 },
      { posten: "passiva.C", label: VERMERK.verbindlichkeitenUeber1Jahr, betrag: 850_000 },
      { posten: "passiva.C", label: VERMERK.verbindlichkeitenGesellschafter, betrag: 400_000 },
    ]);
    // Ohne bestätigte Restlaufzeiten nur die Gesellschafter
    expect(bilanzVermerke(konten, null).map((v) => v.label)).toEqual([
      VERMERK.ausleihungenGesellschafter,
      VERMERK.forderungenGesellschafter,
      VERMERK.verbindlichkeitenGesellschafter,
    ]);
  });

  it("E-Bilanz: Davon-Positionen je Gruppe und in Summe", () => {
    const konten = vermerkKonten(kr, report);
    const ueber1Jahr = new Map([
      [k.darlehen, 600_000],
      [k.forderungGes, 100_000],
      [k.gesellschafter, 250_000],
    ]);
    const werte = ebilanzRestlaufzeiten(kr, konten, ueber1Jahr);
    expect(werte["bs.eqLiab.liab.upTo1year"]).toBe(450_000);
    expect(werte["bs.eqLiab.liab.above1year"]).toBe(850_000);
    expect(werte["bs.eqLiab.liab.shareholders.above1year"]).toBe(250_000);
    expect(werte["bs.eqLiab.liab.shareholders.upTo1year"]).toBe(150_000);
    expect(werte["bs.eqLiab.liab.trade.upTo1year"]).toBe(150_000);
    expect(werte["bs.ass.currAss.receiv.shareholders.above1year"]).toBe(100_000);
    expect(werte["bs.ass.currAss.receiv.trade.upTo1year"]).toBe(500_000);
    expect(werte["bs.ass.currAss.receiv.above1year"]).toBe(100_000);
    // Ausleihungen sind keine Forderungen im Umlaufvermögen
    expect(Object.keys(werte).some((p) => p.startsWith("bs.ass.fixAss"))).toBe(false);
  });

  it("Hinterlegung: Vermerke unter ihrem Posten, mit Vorjahr", () => {
    const vorjahr = abschluss(kr, [
      { account: k.bank, saldo: 2_500_000 },
      { account: k.kapital, saldo: -2_500_000 },
    ]);
    const konten = vermerkKonten(kr, report);
    const bilanz = hinterlegungBilanz({
      year: 2025,
      firma: { name: "Nordlicht GmbH", sitz: "Bremen", registergericht: "Amtsgericht Bremen", registernummer: "HRB 1" },
      report,
      vorjahr,
      angaben: { haftungsverhaeltnisse: "", organkredite: "", festgestelltAm: "2026-06-30" },
      vermerke: { jahr: bilanzVermerke(konten, new Map([[k.darlehen, 600_000]])), vorjahr: bilanzVermerke(vermerkKonten(kr, vorjahr), new Map()) },
    });
    expect(bilanz.passiva.map((z) => [z.label, z.betrag, z.vorjahr, z.vermerk ?? false])).toEqual([
      ["A. Eigenkapital", 2_500_000, 2_500_000, false],
      ["C. Verbindlichkeiten", 1_300_000, 0, false],
      [VERMERK.verbindlichkeitenBis1Jahr, 700_000, 0, true],
      [VERMERK.verbindlichkeitenUeber1Jahr, 600_000, 0, true],
      [VERMERK.verbindlichkeitenGesellschafter, 400_000, 0, true],
    ]);
    expect(bilanz.aktiva[0]).toMatchObject({ label: "A. Anlagevermögen", betrag: 200_000 });
    expect(bilanz.aktiva[1]).toMatchObject({ label: VERMERK.ausleihungenGesellschafter, betrag: 200_000, vorjahr: 0, vermerk: true });
  });
});
