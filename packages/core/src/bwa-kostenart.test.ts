import { describe, expect, it } from "vitest";
import { kostenartOf, type Kostenart } from "./bwa-kostenart.ts";
import { postenOf, type GuvPosten } from "./hgb.ts";
import { EXPENSE_CATEGORIES, type Kontenrahmen } from "./posting.ts";

const RAHMEN = ["SKR03", "SKR04"] as const;
const alleKonten = Array.from({ length: 10_000 }, (_, i) => String(i).padStart(4, "0"));

/** Kostenarten, die zu einem GuV-Posten passen: verfeinert, nie aus einem fremden Posten */
const PASSEND: Record<GuvPosten, readonly Kostenart[]> = {
  umsatzerloese: ["erloese"],
  sonstigeErtraege: ["sonstigeErloese", "neutralerErtrag", "zinsertrag", "bestandsveraenderung", "eigenleistungen"],
  materialaufwand: ["material", "fremdleistungen"],
  personalaufwand: ["personal"],
  abschreibungen: ["abschreibungen", "neutralerAufwand"],
  sonstigeAufwendungen: [
    "raum",
    "versicherungen",
    "kfz",
    "werbeReise",
    "warenabgabe",
    "instandhaltung",
    "sonstigeKosten",
    "zinsaufwand",
    "neutralerAufwand",
    "verrechneteKalkulatorischeKosten",
  ],
  steuern: ["steuernEinkommen", "betrieblicheSteuern"],
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

  const FAELLE: [Kontenrahmen, string, Kostenart | null][] = [
    ["SKR03", "8400", "erloese"],
    ["SKR04", "4400", "erloese"],
    ["SKR03", "8736", "erloese"],
    ["SKR03", "8910", "sonstigeErloese"],
    ["SKR04", "4620", "sonstigeErloese"],
    ["SKR03", "8820", "neutralerErtrag"],
    // Erlöse aus Anlagenverkäufen bei Buchverlust: Aufwand (§ 275 HGB, DATEV „Sonstige betriebliche Aufwendungen“)
    ["SKR03", "8800", "neutralerAufwand"],
    ["SKR03", "2315", "neutralerErtrag"],
    ["SKR04", "7400", "neutralerErtrag"],
    ["SKR04", "4849", "neutralerErtrag"],
    ["SKR03", "2650", "zinsertrag"],
    ["SKR04", "7100", "zinsertrag"],
    ["SKR03", "3200", "material"],
    ["SKR04", "5200", "material"],
    ["SKR03", "3100", "fremdleistungen"],
    ["SKR04", "5900", "fremdleistungen"],
    ["SKR03", "4120", "personal"],
    ["SKR04", "6020", "personal"],
    ["SKR03", "4210", "raum"],
    ["SKR04", "6310", "raum"],
    ["SKR03", "4288", "raum"],
    ["SKR04", "6348", "raum"],
    ["SKR03", "4360", "versicherungen"],
    ["SKR04", "6400", "versicherungen"],
    ["SKR03", "4380", "versicherungen"],
    ["SKR04", "6420", "versicherungen"],
    // Kfz-Steuer: „Fahrzeugkosten (ohne Steuer)“ in der BWA, die Steuer bei den betrieblichen Steuern
    ["SKR03", "4510", "betrieblicheSteuern"],
    ["SKR04", "7685", "betrieblicheSteuern"],
    ["SKR03", "4530", "kfz"],
    ["SKR04", "6530", "kfz"],
    ["SKR03", "4600", "werbeReise"],
    ["SKR04", "6600", "werbeReise"],
    ["SKR03", "4673", "werbeReise"],
    ["SKR04", "6673", "werbeReise"],
    ["SKR03", "4710", "warenabgabe"],
    ["SKR04", "6710", "warenabgabe"],
    ["SKR03", "4805", "instandhaltung"],
    ["SKR04", "6470", "instandhaltung"],
    ["SKR03", "4830", "abschreibungen"],
    ["SKR04", "6220", "abschreibungen"],
    ["SKR03", "4964", "sonstigeKosten"],
    ["SKR04", "6837", "sonstigeKosten"],
    ["SKR03", "2110", "zinsaufwand"],
    ["SKR04", "7310", "zinsaufwand"],
    ["SKR03", "4320", "steuernEinkommen"],
    ["SKR04", "7610", "steuernEinkommen"],
    ["SKR03", "2200", "steuernEinkommen"],
    ["SKR04", "7600", "steuernEinkommen"],
    ["SKR03", "2281", "steuernEinkommen"],
    ["SKR03", "2285", "betrieblicheSteuern"],
    ["SKR03", "2020", "neutralerAufwand"],
    ["SKR04", "6960", "neutralerAufwand"],
    ["SKR03", "2890", "verrechneteKalkulatorischeKosten"],
    ["SKR04", "6980", "verrechneteKalkulatorischeKosten"],
    ["SKR03", "8960", "bestandsveraenderung"],
    ["SKR04", "4800", "bestandsveraenderung"],
    ["SKR03", "8990", "eigenleistungen"],
    ["SKR04", "4820", "eigenleistungen"],
    ["SKR03", "1200", null],
    ["SKR04", "1800", null],
    ["SKR03", "1400", null],
    ["SKR04", "3300", null],
  ];
  it.each(FAELLE)("%s %s → %s", (kr, konto, erwartet) => {
    expect(kostenartOf(kr, konto)).toBe(erwartet);
  });
});
