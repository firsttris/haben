import { describe, expect, it } from "vitest";
import { kostenartOf, type Kostenart } from "./bwa-kostenart.ts";
import { postenOf, type GuvPosten } from "./hgb.ts";
import { EXPENSE_CATEGORIES, type Kontenrahmen } from "./posting.ts";

const RAHMEN = ["SKR03", "SKR04"] as const;
const alleKonten = Array.from({ length: 10_000 }, (_, i) => String(i).padStart(4, "0"));

/** Kostenarten, die zu einem GuV-Posten passen: verfeinert, nie aus einem fremden Posten */
const PASSEND: Record<GuvPosten, readonly Kostenart[]> = {
  umsatzerloese: ["erloese"],
  sonstigeErtraege: ["sonstigeErloese"],
  materialaufwand: ["material", "fremdleistungen"],
  personalaufwand: ["personal"],
  abschreibungen: ["abschreibungen"],
  sonstigeAufwendungen: ["raum", "versicherungen", "kfz", "werbeReise", "warenabgabe", "instandhaltung", "sonstigeKosten"],
  steuern: ["betrieblicheSteuern"],
};

describe("Kostenart der BWA (DATEV-Kontenrahmen 2026)", () => {
  it.each(RAHMEN)("%s: jedes Erfolgskonto hat genau eine Kostenart, passend zu seinem GuV-Posten; Bilanzkonten keine", (kr) => {
    for (const konto of alleKonten) {
      const posten = postenOf(kr, konto);
      const kostenart = kostenartOf(kr, konto);
      if (posten === null || posten.startsWith("aktiva.") || posten.startsWith("passiva.")) expect(kostenart, konto).toBeNull();
      else expect(PASSEND[posten as GuvPosten], `${kr} ${konto} (${posten})`).toContain(kostenart);
    }
  });

  it.each(RAHMEN)("%s: jede Ausgabenkategorie auf einem Erfolgskonto hat eine Kostenart", (kr) => {
    for (const [kategorie, konten] of Object.entries(EXPENSE_CATEGORIES)) {
      if (["anlage", "hardware", "einfuhrumsatzsteuer"].includes(kategorie)) continue;
      expect(kostenartOf(kr, konten[kr]), kategorie).not.toBeNull();
    }
  });

  // Gleich benannte Konten beider Rahmen (DATEV-Kontenrahmen 2026) haben dieselbe Kostenart
  const PAARE: [skr03: string, skr04: string, Kostenart][] = [
    ["8400", "4400", "erloese"],
    ["8736", "4736", "erloese"],
    ["8910", "4620", "sonstigeErloese"],
    ["3200", "5200", "material"],
    ["3100", "5900", "fremdleistungen"],
    ["4120", "6020", "personal"],
    ["4210", "6310", "raum"],
    ["4288", "6348", "raum"],
    // Grundstücksaufwendungen: betrieblich bei den Raumkosten, „sonstige (neutral)“ nicht
    ["4290", "6350", "raum"],
    ["2350", "6352", "sonstigeKosten"],
    ["4360", "6400", "versicherungen"],
    ["4380", "6420", "versicherungen"],
    ["4390", "6430", "versicherungen"],
    ["4139", "6440", "sonstigeKosten"],
    // Kfz-Steuer bei den Steuern, „Kfz-Kosten (o. St.)“
    ["4510", "7685", "betrieblicheSteuern"],
    ["4530", "6530", "kfz"],
    ["4600", "6600", "werbeReise"],
    ["4650", "6640", "werbeReise"],
    ["4673", "6673", "werbeReise"],
    ["4710", "6710", "warenabgabe"],
    ["4805", "6470", "instandhaltung"],
    ["4808", "6475", "instandhaltung"],
    ["4810", "6498", "sonstigeKosten"],
    ["4830", "6220", "abschreibungen"],
    ["4964", "6837", "sonstigeKosten"],
    ["4320", "7610", "betrieblicheSteuern"],
  ];
  it.each(PAARE)("SKR03 %s und SKR04 %s → %s", (skr03, skr04, erwartet) => {
    expect(kostenartOf("SKR03", skr03)).toBe(erwartet);
    expect(kostenartOf("SKR04", skr04)).toBe(erwartet);
  });

  const BILANZ: [Kontenrahmen, string][] = [
    ["SKR03", "1200"],
    ["SKR04", "1800"],
    ["SKR03", "1400"],
    ["SKR04", "3300"],
  ];
  it.each(BILANZ)("%s %s ist kein Erfolgskonto", (kr, konto) => {
    expect(kostenartOf(kr, konto)).toBeNull();
  });
});
