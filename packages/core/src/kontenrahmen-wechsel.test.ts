import { describe, expect, it } from "vitest";
import { ASSET_ACCOUNTS } from "./afa.ts";
import { kontoImKontenrahmen, zeilenImKontenrahmen } from "./kontenrahmen-wechsel.ts";
import { LOHN_KONTEN } from "./lohn-buchung.ts";
import { ACCOUNTS, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS, type Kontenrahmen } from "./posting.ts";

/*
 * Konten nach einem Wechsel des Kontenrahmens übertragen (#570): dieselbe Rolle im anderen Rahmen, in beide Richtungen;
 * ohne eindeutige Entsprechung null.
 */

const RICHTUNGEN: [Kontenrahmen, Kontenrahmen][] = [
  ["SKR03", "SKR04"],
  ["SKR04", "SKR03"],
];

describe.each(RICHTUNGEN)("Konten von %s nach %s", (von, nach) => {
  it("Forderungen, Kasse, Bank, Umsatz- und Vorsteuer, Erlöse, Forderungsverluste und Skonto", () => {
    for (const rolle of [
      "forderungen",
      "verbindlichkeiten",
      "zwischenkonto",
      "kasse",
      "bank",
      "forderungsverluste",
      "skontiGewaehrt",
      "skontiErhalten",
      "privatentnahmen",
    ] as const) {
      expect(kontoImKontenrahmen(von, nach, ACCOUNTS[von][rolle]), rolle).toBe(ACCOUNTS[nach][rolle]);
    }
    for (const satz of [1900, 700] as const) {
      expect(kontoImKontenrahmen(von, nach, ACCOUNTS[von].ust[satz])).toBe(ACCOUNTS[nach].ust[satz]);
      expect(kontoImKontenrahmen(von, nach, ACCOUNTS[von].ustNichtFaellig[satz])).toBe(ACCOUNTS[nach].ustNichtFaellig[satz]);
      expect(kontoImKontenrahmen(von, nach, ACCOUNTS[von].vorsteuer[satz])).toBe(ACCOUNTS[nach].vorsteuer[satz]);
      expect(kontoImKontenrahmen(von, nach, ACCOUNTS[von].erloese[satz])).toBe(ACCOUNTS[nach].erloese[satz]);
    }
    expect(kontoImKontenrahmen(von, nach, LOHN_KONTEN[von].verbLohn)).toBe(LOHN_KONTEN[nach].verbLohn);
  });

  it("Aufwand je Kategorie", () => {
    for (const kategorie of EXPENSE_CATEGORY_KEYS) {
      const ziel = kontoImKontenrahmen(von, nach, EXPENSE_CATEGORIES[kategorie][von]);
      // Teilen sich zwei Rollen ein Konto mit verschiedener Entsprechung, gibt es keine eindeutige
      if (ziel !== null) expect(ziel, kategorie).toBe(EXPENSE_CATEGORIES[kategorie][nach]);
    }
  });

  it("ohne eindeutige Entsprechung null, im selben Kontenrahmen unverändert", () => {
    expect(kontoImKontenrahmen(von, nach, "9999")).toBeNull();
    expect(kontoImKontenrahmen(von, von, "9999")).toBe("9999");
    // SKR03 0420 ist Anlagekonto für EDV und Büro; in SKR04 zwei Konten
    if (ASSET_ACCOUNTS[von].anlage.edv === ASSET_ACCOUNTS[von].anlage.buero && ASSET_ACCOUNTS[nach].anlage.edv !== ASSET_ACCOUNTS[nach].anlage.buero) {
      expect(kontoImKontenrahmen(von, nach, ASSET_ACCOUNTS[von].anlage.edv)).toBeNull();
    }
  });

  it("Zeilen: alle übertragen oder keine", () => {
    const zeilen = [
      { account: ACCOUNTS[von].kasse, debit: 0, credit: 11_900 },
      { account: ACCOUNTS[von].forderungen, debit: 11_900, credit: 0 },
    ];
    expect(zeilenImKontenrahmen(von, nach, zeilen)).toEqual([
      { account: ACCOUNTS[nach].kasse, debit: 0, credit: 11_900 },
      { account: ACCOUNTS[nach].forderungen, debit: 11_900, credit: 0 },
    ]);
    expect(zeilenImKontenrahmen(von, nach, [...zeilen, { account: "9999", debit: 1, credit: 0 }])).toBeNull();
  });
});
