import { describe, expect, it } from "vitest";
import { FORM01, FORM01_ZEILEN, form01, form01Betrag, form01Zeile, type Form01Saldo, type Form01Zeile } from "./bwa-form01.ts";
import { abschluss, isBilanz, postenOf } from "./hgb.ts";
import { ACCOUNT_NAMES } from "./kontenplan.ts";
import { ACCOUNTS, EXPENSE_CATEGORIES, type Kontenrahmen } from "./posting.ts";
import { carriesForward } from "./vortrag.ts";

const RAHMEN = ["SKR03", "SKR04"] as const;
const alleKonten = Array.from({ length: 10_000 }, (_, i) => String(i).padStart(4, "0"));
const ZEILEN = new Set<string>(FORM01_ZEILEN);

/** Alle Konten, die Haben kennt: benannte Konten, Systemkonten und die Konten der Kategorien */
const bekannteKonten = (kr: Kontenrahmen) => {
  const flach = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(flach) : []);
  return [...new Set([...Object.keys(ACCOUNT_NAMES[kr]), ...flach(ACCOUNTS[kr]), ...Object.values(EXPENSE_CATEGORIES).map((c) => c[kr])])].filter((k) =>
    /^\d{4}$/.test(k),
  );
};

/**
 * Konten der Ergebnisverwendung nach dem Jahresergebnis (§ 158 AktG) laut DATEV-Kontenrahmen 2026: SKR03 S. 15 f. und
 * S. 17 f., SKR04 S. 29. Sie haben keinen GuV-Posten (hgb.ts) und stehen in Form 01 nicht, wie in der GuV.
 */
const ERGEBNISVERWENDUNG: Record<Kontenrahmen, readonly [string, string][]> = {
  SKR03: [
    ["2480", "2489"],
    ["2495", "2499"],
    ["2745", "2745"],
    ["2795", "2799"],
    ["2840", "2870"],
  ],
  SKR04: [["7700", "7790"]],
};
const ergebnisverwendung = (kr: Kontenrahmen, konto: string) => ERGEBNISVERWENDUNG[kr].some(([von, bis]) => konto >= von && konto <= bis);

const saldo = (kontenrahmen: Kontenrahmen, account: string, betrag: number): Form01Saldo => ({ kontenrahmen, account, saldo: betrag });

describe("Kurzfristige Erfolgsrechnung (DATEV-Form 01)", () => {
  it.each(RAHMEN)("%s: jedes Konto aus kontenplan.ts, das kein Bestandskonto ist, steht in genau einer Zeile", (kr) => {
    let erfolgskonten = 0;
    for (const konto of bekannteKonten(kr)) {
      const zeile = form01Zeile(kr, konto);
      if (carriesForward(kr, konto)) {
        expect(zeile, `${kr} ${konto}`).toBeNull();
        continue;
      }
      erfolgskonten++;
      expect(ZEILEN.has(zeile!), `${kr} ${konto}`).toBe(true);
      // Haben bucht nichts in eine Lücke des Kontenrahmens
      expect(zeile, `${kr} ${konto}`).not.toBe("unbesetzt");
    }
    expect(erfolgskonten).toBeGreaterThan(50);
  });

  it.each(RAHMEN)("%s: jedes Erfolgskonto mit GuV-Posten hat eine Zeile mit Kostenart, eines ohne steht unter „Kontenklasse unbesetzt“", (kr) => {
    for (const konto of alleKonten) {
      const zeile = form01Zeile(kr, konto);
      if (carriesForward(kr, konto) || ergebnisverwendung(kr, konto)) expect(zeile, konto).toBeNull();
      else {
        const posten = postenOf(kr, konto);
        expect(zeile === "unbesetzt", `${kr} ${konto} (${posten})`).toBe(posten === null || isBilanz(posten));
      }
    }
  });

  it.each(RAHMEN)("%s: über alle Erfolgskonten ist das vorläufige Ergebnis das Jahresergebnis der GuV", (kr) => {
    // Je Konto ein anderer Betrag, im Soll und im Haben, damit ein falsches Vorzeichen auffällt
    const salden = alleKonten
      .filter((k) => !carriesForward(kr, k) && form01Zeile(kr, k) !== "unbesetzt")
      .map((k, i) => saldo(kr, k, (i % 2 === 0 ? 1 : -1) * (Number(k) + 1)));
    expect(form01(salden).vorlaeufigesErgebnis).toBe(abschluss(kr, salden).jahresergebnis);
    expect(form01(salden).unbesetzt).toBe(0);
  });

  it("Konten in einer Lücke stehen unter „Kontenklasse unbesetzt“ und zählen zum Ergebnis vor Steuern", () => {
    // SKR03 4310: Lücke zwischen 4306 und 4320
    expect(form01Zeile("SKR03", "4310")).toBe("unbesetzt");
    const w = form01([saldo("SKR03", "8400", -100_000), saldo("SKR03", "4310", 3_000)]);
    expect(w.unbesetzt).toBe(-3_000);
    expect(w.ergebnisVorSteuern).toBe(97_000);
    // In der GuV fehlt das Konto als nicht zugeordnet
    expect(abschluss("SKR03", [saldo("SKR03", "8400", -100_000), saldo("SKR03", "4310", 3_000)]).jahresergebnis).toBe(100_000);
  });

  it.each([
    ["SKR03", "2496"], // Einstellungen in die gesetzliche Rücklage
    ["SKR03", "2745"], // Ertrag aus der Kapitalherabsetzung
    ["SKR03", "2860"], // Gewinnvortrag nach Verwendung
    ["SKR03", "2870"], // Vorabausschüttung
    ["SKR04", "7765"], // Einstellungen in die gesetzliche Rücklage
    ["SKR04", "7755"], // Ertrag aus der Kapitalherabsetzung
    ["SKR04", "7700"], // Gewinnvortrag nach Verwendung
    ["SKR04", "7790"], // Vorabausschüttung
  ] as const)("%s %s: Ergebnisverwendung steht wie in der GuV nicht in Form 01, auch nicht unter „Kontenklasse unbesetzt“", (kr, konto) => {
    expect(form01Zeile(kr, konto)).toBeNull();
    const salden = [saldo(kr, kr === "SKR03" ? "8400" : "4400", -100_000), saldo(kr, konto, 30_000)];
    const w = form01(salden);
    expect(w.unbesetzt).toBe(0);
    expect(w.vorlaeufigesErgebnis).toBe(100_000);
    expect(w.vorlaeufigesErgebnis).toBe(abschluss(kr, salden).jahresergebnis);
  });

  it("Bestandskonten, Vortragskonten und Personenkonten zählen nicht", () => {
    for (const [kr, konto] of [
      ["SKR03", "1200"],
      ["SKR03", "9000"],
      ["SKR04", "1800"],
      ["SKR04", "70001"],
      ["SKR03", "10000"],
    ] as const)
      expect(form01Zeile(kr, konto), `${kr} ${konto}`).toBeNull();
    expect(form01([saldo("SKR03", "1200", 50_000), saldo("SKR04", "70001", 1_000)]).vorlaeufigesErgebnis).toBe(0);
  });

  it("Summen und Vorzeichen: Erträge mit Haben-Saldo, Aufwand mit Soll-Saldo positiv", () => {
    const w = form01([
      saldo("SKR03", "8400", -1_000_000),
      saldo("SKR03", "8970", -20_000), // Bestandsveränderung
      saldo("SKR03", "8990", -5_000), // aktivierte Eigenleistung
      saldo("SKR03", "3400", 300_000), // Wareneingang
      saldo("SKR03", "3100", 100_000), // Fremdleistungen beim Material
      saldo("SKR03", "8590", -10_000), // verrechnete Sachbezüge: sonstige betriebliche Erlöse
      saldo("SKR03", "4120", 200_000),
      saldo("SKR03", "4210", 50_000),
      saldo("SKR03", "4340", 1_000),
      saldo("SKR03", "4360", 2_000),
      saldo("SKR03", "4530", 3_000),
      saldo("SKR03", "4600", 4_000),
      saldo("SKR03", "4710", 5_000),
      saldo("SKR03", "4830", 6_000),
      saldo("SKR03", "4805", 7_000),
      saldo("SKR03", "4964", 8_000),
      saldo("SKR03", "2110", 9_000), // Zinsaufwand
      saldo("SKR03", "2400", 10_000), // Forderungsverlust
      saldo("SKR03", "2150", 1_500), // Kursverlust
      saldo("SKR03", "2650", -2_000), // Zinsertrag
      saldo("SKR03", "2660", -700), // Kursgewinn
      saldo("SKR03", "2890", -1_200), // verrechnete kalkulatorische Kosten
      saldo("SKR03", "2200", 50_000), // Körperschaftsteuer
      saldo("SKR03", "4320", 40_000), // Gewerbesteuer
    ]);
    expect(w.gesamtleistung).toBe(1_025_000);
    expect(w.material).toBe(400_000);
    expect(w.rohertrag).toBe(625_000);
    expect(w.sonstigeErloese).toBe(10_000);
    expect(w.betrieblicherRohertrag).toBe(635_000);
    expect(w.gesamtkosten).toBe(286_000);
    expect(w.betriebsergebnis).toBe(349_000);
    expect([w.zinsaufwand, w.neutralAufwand, w.neutralerAufwand]).toEqual([9_000, 11_500, 20_500]);
    expect([w.zinsertrag, w.neutralErtrag, w.kalkulatorisch, w.neutralerErtrag]).toEqual([2_000, 700, 1_200, 3_900]);
    expect(w.ergebnisVorSteuern).toBe(332_400);
    expect(w.ertragsteuern).toBe(90_000);
    expect(w.vorlaeufigesErgebnis).toBe(242_400);
    expect(w.besondereKosten).toBe(0);
  });

  it("dieselben Buchungen ergeben in SKR03 und SKR04 dieselben Zeilen", () => {
    const paare: [string, string, number][] = [
      ["8400", "4400", -100_000],
      ["4964", "6837", 5_000],
      ["2400", "6930", 1_000],
      ["2170", "6860", 190],
      ["2150", "6880", 300],
      ["2660", "4840", -200],
      ["2100", "7300", 400],
      ["2650", "7100", -50],
      ["2200", "7600", 2_000],
      ["4320", "7610", 1_500],
    ];
    const w03 = form01(paare.map(([k03, , b]) => saldo("SKR03", k03, b)));
    const w04 = form01(paare.map(([, k04, b]) => saldo("SKR04", k04, b)));
    expect(w04).toEqual(w03);
    expect(w03.neutralAufwand).toBe(1_490);
  });

  it.each([
    ["SKR03", "2310", "8820"],
    ["SKR04", "6895", "4845"],
  ] as const)("%s: ein Anlagenabgang steht mit Restbuchwert %s und Erlös %s nur im sonstigen neutralen Ergebnis", (kr, restbuchwert, erloes) => {
    // Restbuchwert 3.000 €, Verkauf für 5.000 € netto: 2.000 € Buchgewinn
    const w = form01([saldo(kr, restbuchwert, 300_000), saldo(kr, erloes, -500_000)]);
    expect([w.neutralAufwand, w.neutralErtrag, w.sonstigeErloese, w.betriebsergebnis]).toEqual([300_000, 500_000, 0, 0]);
    expect(w.vorlaeufigesErgebnis).toBe(200_000);
  });

  it("Betrag je Zeile: Ertragszeilen drehen das Vorzeichen des Saldos", () => {
    const ertrag: Form01Zeile[] = [
      "umsatzerloese",
      "bestandsveraenderungen",
      "eigenleistungen",
      "sonstigeErloese",
      "zinsertrag",
      "neutralErtrag",
      "kalkulatorisch",
      "unbesetzt",
    ];
    for (const zeile of FORM01_ZEILEN) expect(form01Betrag(zeile, -100), zeile).toBe(ertrag.includes(zeile) ? 100 : -100);
  });

  it("jede Zeile und Summe steht genau einmal in der Auswertung", () => {
    const keys = FORM01.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const z of FORM01_ZEILEN) expect(keys).toContain(z);
  });
});
