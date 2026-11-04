import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { einkommensteuer } from "../income-tax.ts";
import { ganzzahl } from "./dezimal.ts";
import { type LohnsteuerEingabe, lohnsteuer } from "./index.ts";
import { uptab } from "./pap.ts";
import { PAP_2026 } from "./pap-2026.ts";

/**
 * Ergebnisse der externen Schnittstelle des BMF-Steuerrechners für 2026
 * (https://www.bmf-steuerrechner.de/interface/2026Version1.xhtml?code=LSt2026ext), 207 Fälle: Steuerklassen I bis VI,
 * alle vier Lohnzahlungszeiträume, Arbeitslohn von 0 bis 100.000 €, dazu KVZ, PVZ, PVS, PVA, ZKF und PKV. Die Fälle
 * stammen aus `tests/fixtures/bmf-2026.json` in canida-software/lohnsteuer (MIT, © 2026 Canida Software); übernommen
 * sind die Eingaben in den Einheiten des BMF und die Ausgaben LSTLZZ, SOLZLZZ und BK. Am 04.11.2026 alle 207 Fälle
 * erneut bei der Schnittstelle abgerufen: Die Antworten stimmen mit der Datei überein.
 */
interface BmfFall {
  eingabe: {
    LZZ: 1 | 2 | 3 | 4;
    RE4: number;
    STKL: 1 | 2 | 3 | 4 | 5 | 6;
    KVZ?: number;
    ZKF?: number;
    PVZ?: 0 | 1;
    PVS?: 0 | 1;
    PVA?: 0 | 1 | 2 | 3 | 4;
    PKV?: 0 | 1;
    PKPV?: number;
  };
  LSTLZZ: number;
  SOLZLZZ: number;
  BK: number;
}

const BMF_FAELLE: BmfFall[] = JSON.parse(readFileSync(new URL("../../test-fixtures/lohnsteuer/bmf-2026.json", import.meta.url), "utf8"));

/** Die Schnittstelle nimmt KVZ in Prozent und ZKF als Dezimalzahl; Haben Basispunkte und Tausendstel */
function inHabenEinheiten({ KVZ, ZKF, ...rest }: BmfFall["eingabe"]): LohnsteuerEingabe {
  return { ...rest, ...(KVZ === undefined ? {} : { KVZ: Math.round(KVZ * 100) }), ...(ZKF === undefined ? {} : { ZKF: Math.round(ZKF * 1000) }) };
}

describe("lohnsteuer 2026 gegen den BMF-Steuerrechner", () => {
  it("deckt alle Steuerklassen und Lohnzahlungszeiträume ab", () => {
    expect(BMF_FAELLE).toHaveLength(207);
    expect(new Set(BMF_FAELLE.map((f) => f.eingabe.STKL))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(new Set(BMF_FAELLE.map((f) => f.eingabe.LZZ))).toEqual(new Set([1, 2, 3, 4]));
  });

  it.each(BMF_FAELLE.map((fall) => [JSON.stringify(fall.eingabe), fall] as const))("%s", (_, fall) => {
    expect(lohnsteuer(2026, inHabenEinheiten(fall.eingabe))).toEqual({ ok: true, LSTLZZ: fall.LSTLZZ, SOLZLZZ: fall.SOLZLZZ, BK: fall.BK });
  });
});

/**
 * Eigener Abruf bei derselben Schnittstelle am 04.11.2026 für das, was die 207 Fälle nicht abdecken:
 * Gesellschafter-Geschäftsführer ohne Renten- und Arbeitslosenversicherung (KRV = 1, ALV = 1), privat versichert mit
 * Arbeitgeberzuschuss (PKPVAGZ, auch größer als der Beitrag), Kinder in den Klassen II bis IV, Kirchensteuer (R = 1),
 * Wochen- und Tageslohn. Die Eingaben stehen hier in den Einheiten von Haben (KVZ in Basispunkten, ZKF in Tausendsteln);
 * die Ausgaben sind die Antworten des BMF.
 */
const BMF_ABRUF: { eingabe: LohnsteuerEingabe; LSTLZZ: number; SOLZLZZ: number; BK: number }[] = JSON.parse(
  readFileSync(new URL("../../test-fixtures/lohnsteuer/bmf-2026-abruf.json", import.meta.url), "utf8"),
);

describe("lohnsteuer 2026 gegen den BMF-Steuerrechner, Geschäftsführer, PKV mit Zuschuss und Kirchensteuer", () => {
  it.each(BMF_ABRUF.map((fall) => [JSON.stringify(fall.eingabe), fall] as const))("%s", (_, { eingabe, LSTLZZ, SOLZLZZ, BK }) => {
    expect(lohnsteuer(2026, eingabe)).toEqual({ ok: true, LSTLZZ, SOLZLZZ, BK });
  });
});

/**
 * Querprobe mit dem Paket lohnsteuer-bmf 2026.3 (PyPI, MIT, L1nch-lab/lohnsteuer-bmf), `berechne_lohnsteuer_pap`.
 * Die Fälle stehen mit der Antwort des BMF auch in `bmf-2026-abruf.json` (die ersten neun); hier bleibt die
 * Jahressteuer als zweite, unabhängige Rechnung: Gesellschafter-Geschäftsführer ohne Renten- und
 * Arbeitslosenversicherung (KRV = 1, ALV = 1), privat versichert mit Arbeitgeberzuschuss, Kinder in den Klassen
 * II bis IV, Soli mit Kindern, Kirchensteuer. Das Paket rechnet in Gleitkomma und rundet den Monatsbetrag
 * kaufmännisch; übernommen ist deshalb seine Jahressteuer in Euro (Lohnsteuer, Bemessungsgrundlage für Soli und
 * Kirchensteuer, Soli), daraus der Monatsbetrag wie im PAP (UPANTEIL: Jahresbetrag in Cent / 12, abgerundet).
 */
const QUERPROBE: [string, LohnsteuerEingabe, { lstJahr: number; jbmg: number; solzJahrCent: number }][] = [
  [
    "Gesellschafter-Geschäftsführer, privat versichert, ohne RV- und AV-Pflicht, monatlich",
    { LZZ: 2, RE4: 8_000_00, STKL: 1, KRV: 1, ALV: 1, PKV: 1, PKPV: 600_00, PKPVAGZ: 300_00, R: 1 },
    { lstJahr: 27_140, jbmg: 27_140, solzJahrCent: 808_01 },
  ],
  [
    "Gesellschafter-Geschäftsführer, Steuerklasse III, zwei Kinder, privat versichert, jährlich",
    { LZZ: 1, RE4: 120_000_00, STKL: 3, ZKF: 2000, KRV: 1, ALV: 1, PKV: 1, PKPV: 900_00, PKPVAGZ: 450_00, R: 1 },
    { lstJahr: 25_932, jbmg: 18_960, solzJahrCent: 0 },
  ],
  [
    "Gesellschafter-Geschäftsführer, gesetzlich krankenversichert, ohne RV- und AV-Pflicht",
    { LZZ: 2, RE4: 6000_00, STKL: 1, KRV: 1, ALV: 1, KVZ: 290, PVZ: 1, R: 1 },
    { lstJahr: 15_472, jbmg: 15_472, solzJahrCent: 0 },
  ],
  ["Steuerklasse II, ein Kind", { LZZ: 2, RE4: 3500_00, STKL: 2, ZKF: 500, KVZ: 290, R: 1 }, { lstJahr: 3732, jbmg: 2427, solzJahrCent: 0 }],
  ["Steuerklasse III, drei Kinder", { LZZ: 2, RE4: 6000_00, STKL: 3, ZKF: 3000, KVZ: 290, PVA: 2, R: 1 }, { lstJahr: 7660, jbmg: 506, solzJahrCent: 0 }],
  ["Steuerklasse IV, zwei Kinder", { LZZ: 2, RE4: 4500_00, STKL: 4, ZKF: 2000, KVZ: 290, PVA: 1, R: 1 }, { lstJahr: 7950, jbmg: 4949, solzJahrCent: 0 }],
  ["Steuerklasse V, kinderlos", { LZZ: 2, RE4: 3000_00, STKL: 5, KVZ: 290, PVZ: 1, R: 1 }, { lstJahr: 7508, jbmg: 7508, solzJahrCent: 0 }],
  [
    "Steuerklasse I, Soli mit Kindern",
    { LZZ: 2, RE4: 10_000_00, STKL: 1, ZKF: 1000, KVZ: 290, PVA: 1, R: 1 },
    { lstJahr: 31_842, jbmg: 27_744, solzJahrCent: 879_89 },
  ],
  [
    "Steuerklasse I, 1 Mio. € im Jahr",
    { LZZ: 1, RE4: 1_000_000_00, STKL: 1, KVZ: 290, PVZ: 1, R: 1 },
    { lstJahr: 422_310, jbmg: 422_310, solzJahrCent: 23_227_05 },
  ],
];

describe("lohnsteuer 2026, Querprobe mit lohnsteuer-bmf", () => {
  it.each(QUERPROBE)("%s", (_, eingabe, { lstJahr, jbmg, solzJahrCent }) => {
    const anteil = (jahrCent: number) => (eingabe.LZZ === 1 ? jahrCent : Math.floor(jahrCent / 12));
    expect(lohnsteuer(2026, eingabe)).toEqual({ ok: true, LSTLZZ: anteil(lstJahr * 100), SOLZLZZ: anteil(solzJahrCent), BK: anteil(jbmg * 100) });
  });
});

describe("lohnsteuer 2026, Grenzfälle", () => {
  it("ist bei Lohn 0 in jeder Steuerklasse und jedem Zeitraum null", () => {
    for (const STKL of [1, 2, 3, 4, 5, 6] as const) {
      for (const LZZ of [1, 2, 3, 4] as const) {
        expect(lohnsteuer(2026, { LZZ, RE4: 0, STKL, R: 1, ZKF: 1000 })).toEqual({ ok: true, LSTLZZ: 0, SOLZLZZ: 0, BK: 0 });
      }
    }
  });

  it("rechnet sehr hohe Löhne exakt im Spitzensteuersatz", () => {
    // 10 Mio. € im Jahr, über allen Beitragsbemessungsgrenzen. Vorsorgepauschale: 101.400 € · 9,3 % = 9.430,20 €
    // plus 69.750 € · (7 % + 1,8 %) = 6.138 €, aufgerundet 15.569 €. zvE = 10.000.000 − 1.230 − 36 − 15.569
    // = 9.983.165 €; Lohnsteuer wie Einkommensteuer darauf, Soli 5,5 % ohne Milderung.
    const zvE = 9_983_165_00;
    expect(einkommensteuer(zvE, 2026)).toBe(4_472_953_00);
    expect(lohnsteuer(2026, { LZZ: 1, RE4: 10_000_000_00, STKL: 1 })).toEqual({ ok: true, LSTLZZ: 4_472_953_00, SOLZLZZ: 246_012_41, BK: 0 });
  });

  it("gibt ohne Kirchensteuerpflicht keine Bemessungsgrundlage aus, mit ihr ohne Kinder die Lohnsteuer", () => {
    const ohne = lohnsteuer(2026, { LZZ: 2, RE4: 5000_00, STKL: 1, KVZ: 290 });
    const mit = lohnsteuer(2026, { LZZ: 2, RE4: 5000_00, STKL: 1, KVZ: 290, R: 1 });
    expect(ohne.ok && ohne.BK).toBe(0);
    expect(mit.ok && mit.BK).toBe(mit.ok && mit.LSTLZZ);
  });

  it("zieht den Arbeitgeberzuschuss zur PKV höchstens bis auf null ab", () => {
    const zuschussGroesser = lohnsteuer(2026, { LZZ: 2, RE4: 5000_00, STKL: 1, PKV: 1, PKPV: 300_00, PKPVAGZ: 400_00 });
    const ohneBeitrag = lohnsteuer(2026, { LZZ: 2, RE4: 5000_00, STKL: 1, PKV: 1 });
    expect(zuschussGroesser).toEqual(ohneBeitrag);
  });
});

describe("Gegenprobe mit income-tax.ts", () => {
  it("UPTAB26 entspricht dem Jahrestarif der Steuerprognose, Grund- und Splittingtarif", () => {
    const grenzen = [0, 12_348, 12_349, 17_799, 17_800, 69_878, 69_879, 277_825, 277_826, 1_000_000];
    const raster = Array.from({ length: 4000 }, (_, i) => i * 97);
    for (const X of [...grenzen, ...raster]) {
      expect(Number(uptab(ganzzahl(X), 1, PAP_2026).wert) * 100, `${X}`).toBe(einkommensteuer(X * 100, 2026));
      // Splitting: der PAP halbiert das zvE vor UPTAB26 (UPMLST) und verdoppelt danach
      expect(Number(uptab(ganzzahl(X), 2, PAP_2026).wert) * 100, `${X} Splitting`).toBe(einkommensteuer(X * 2 * 100, 2026, true));
    }
  });
});
