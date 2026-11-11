import { describe, expect, it } from "vitest";
import { ASSET_ACCOUNTS } from "./afa.ts";
import { darlehenKonto, darlehenZinskonto } from "./darlehen.ts";
import { datevFormelKonto, euerZuordnung } from "./journal-euer.ts";
import { LOHN_KONTEN } from "./lohn-buchung.ts";
import { ACCOUNTS, EXPENSE_CATEGORY_KEYS, EXPENSE_CATEGORIES, type Kontenrahmen } from "./posting.ts";

/*
 * Konten der DATEV-Formel für den Gewinn der EÜR (#542, Schritt 5c): Erfolgskonten, Steuerkonten, Forderungen und
 * Verbindlichkeiten zählen; Geld, Privat, Anlagen, Darlehen und Vortrag nicht. SKR03 und SKR04.
 */

describe.each(["SKR03", "SKR04"] as Kontenrahmen[])("Konten der DATEV-Formel (%s)", (kr) => {
  const a = ACCOUNTS[kr];

  it("Erlöse, Aufwand je Kategorie, Steuerkonten, Forderungen und Verbindlichkeiten zählen", () => {
    const konten = [
      a.erloese[1900],
      a.erloese[700],
      a.erloese[0],
      ...Object.values(a.erloeseSonder),
      ...Object.values(a.ust),
      ...Object.values(a.ustNichtFaellig),
      ...Object.values(a.vorsteuer),
      a.ustRc,
      a.vorsteuerRc,
      a.ustVorauszahlung,
      a.forderungen,
      a.verbindlichkeiten,
      LOHN_KONTEN[kr].verbLohn,
      ASSET_ACCOUNTS[kr].afa,
      darlehenZinskonto({ geber: "bank", laufzeit: "bis1", zweck: "betrieb" }, kr),
    ];
    for (const konto of konten) expect(datevFormelKonto(kr, konto), konto).toBe(true);
  });

  it("jedes Konto mit einer EÜR-Zeile zählt, außer dem GWG-Konto (Kategorie Hardware, als Anlage Anlagevermögen)", () => {
    for (const kategorie of EXPENSE_CATEGORY_KEYS) {
      const konto = EXPENSE_CATEGORIES[kategorie][kr];
      if (euerZuordnung(kr, konto) === null || konto === ASSET_ACCOUNTS[kr].gwg) continue;
      expect(datevFormelKonto(kr, konto), `${kategorie} ${konto}`).toBe(true);
    }
  });

  it("Bank, Kasse, Privat, Anlagen, Darlehen und Saldenvortrag zählen nicht", () => {
    const konten = [
      a.bank,
      a.kasse,
      a.privatentnahmen,
      a.privateinlagen,
      a.saldenvortrag,
      EXPENSE_CATEGORIES.anlage[kr],
      ASSET_ACCOUNTS[kr].gwg,
      darlehenKonto({ geber: "bank", laufzeit: "bis1" }, kr),
    ];
    for (const konto of konten) expect(datevFormelKonto(kr, konto), konto).toBe(false);
  });
});
