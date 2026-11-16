import { describe, expect, it } from "vitest";
import { auswerten, NEUER_MITARBEITER, texte } from "./MitarbeiterForm.tsx";

const mit = (aenderung: Partial<ReturnType<typeof texte>>) =>
  auswerten(NEUER_MITARBEITER, { ...texte(NEUER_MITARBEITER), monatsgehalt: "3.000,00", ...aenderung });

describe("Sätze im Mitarbeiterformular", () => {
  it("liest Zusatzbeitrag und Umlage wie jedes Prozentfeld, auch mit „%“ (#1222)", () => {
    const werte = mit({ zusatzbeitrag: "2,9 %", u2Satz: "0.24" });
    expect(typeof werte === "string" ? werte : [werte.zusatzbeitrag, werte.u2Satz]).toEqual([290, 24]);
  });

  it("nennt bei einem ungültigen Satz den Satz, nicht einen Betrag", () => {
    expect(mit({ zusatzbeitrag: "2,9 €" })).toBe("Zusatzbeitrag: kein gültiger Satz in Prozent, etwa 1,7.");
  });

  it("meldet einen ungültigen Betrag wie jedes Betragsfeld (#1242)", () => {
    expect(mit({ monatsgehalt: "viel" })).toBe("Monatsgehalt: Trag den Betrag ein, etwa 1.234,56.");
    expect(mit({ pkvZuschuss: "3€00" })).toBe("Zuschuss zur privaten Versicherung: Trag den Betrag ein, etwa 1.234,56.");
  });
});
