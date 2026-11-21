import { describe, expect, it } from "vitest";
import { kostenartOf, type Kostenart } from "./bwa-kostenart.ts";
import { postenOf, type GuvPosten } from "./hgb.ts";
import { EXPENSE_CATEGORIES, type Kontenrahmen } from "./posting.ts";

const RAHMEN = ["SKR03", "SKR04"] as const;
const alleKonten = Array.from({ length: 10_000 }, (_, i) => String(i).padStart(4, "0"));

/** Kostenarten, die zu einem GuV-Posten passen: verfeinert, nie aus einem fremden Posten */
const PASSEND: Record<GuvPosten, readonly Kostenart[]> = {
  // Grundstückserträge (SKR03 2750, SKR04 4860) sind Umsatzerlöse der GuV und in Form 01 neutral
  umsatzerloese: ["erloese", "neutralErtrag"],
  sonstigeErtraege: ["sonstigeErloese", "bestandsveraenderungen", "eigenleistungen", "zinsertrag", "neutralErtrag"],
  // Nicht abziehbare Vorsteuer beim Wareneingang (SKR03 3600, SKR04 5600)
  materialaufwand: ["material", "fremdleistungen", "neutralAufwand"],
  personalaufwand: ["personal"],
  // Forderungsverluste, soweit unüblich hoch (SKR03 2430, SKR04 6280)
  abschreibungen: ["abschreibungen", "neutralAufwand"],
  sonstigeAufwendungen: [
    "raum",
    "versicherungen",
    "kfz",
    "werbeReise",
    "warenabgabe",
    "instandhaltung",
    "sonstigeKosten",
    "zinsaufwand",
    "neutralAufwand",
    "kalkulatorisch",
  ],
  // Steuern vom Einkommen und Ertrag, Steuern für Vorjahre (SKR03 2285, SKR04 7690) neutral
  steuern: ["betrieblicheSteuern", "ertragsteuern", "neutralAufwand"],
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
    // Grundstücksaufwendungen: betrieblich bei den Raumkosten, „sonstige (neutral)“ neutral
    ["4290", "6350", "raum"],
    ["2350", "6352", "neutralAufwand"],
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
    // Gewerbesteuer ist eine Steuer vom Einkommen und Ertrag (GuV-Posten beider Rahmen); Form 43 zeigt sie bei den Steuern
    ["4320", "7610", "ertragsteuern"],
    ["4340", "7650", "betrieblicheSteuern"],
    ["2375", "7680", "betrieblicheSteuern"],
    // Neutral (Entscheidung in #1460): Forderungsverluste, nicht abziehbare Vorsteuer, Kursdifferenzen
    ["2400", "6930", "neutralAufwand"],
    ["2406", "6936", "neutralAufwand"],
    ["2430", "6280", "neutralAufwand"],
    ["2170", "6860", "neutralAufwand"],
    ["2171", "6865", "neutralAufwand"],
    ["2176", "6871", "neutralAufwand"],
    ["3600", "5600", "neutralAufwand"],
    ["3610", "5610", "neutralAufwand"],
    ["3660", "5660", "neutralAufwand"],
    ["2150", "6880", "neutralAufwand"],
    ["2151", "6881", "neutralAufwand"],
    ["2660", "4840", "neutralErtrag"],
    ["2661", "4847", "neutralErtrag"],
    ["2166", "6883", "neutralAufwand"],
    ["2666", "4843", "neutralErtrag"],
    // Betriebsfremd, periodenfremd, außergewöhnlich
    ["2007", "7553", "neutralAufwand"],
    ["2020", "6960", "neutralAufwand"],
    ["2308", "6968", "neutralAufwand"],
    ["2310", "6895", "neutralAufwand"],
    ["2315", "4855", "neutralErtrag"],
    // Erlöse aus Anlagenverkäufen neutral wie der Restbuchwert: ein Anlagenabgang in einer Zeile
    ["8800", "6889", "neutralAufwand"],
    ["8801", "6885", "neutralAufwand"],
    ["8807", "6884", "neutralAufwand"],
    ["8817", "6890", "neutralAufwand"],
    ["8819", "6892", "neutralAufwand"],
    ["8820", "4845", "neutralErtrag"],
    ["8827", "4844", "neutralErtrag"],
    ["8829", "4849", "neutralErtrag"],
    ["8837", "4850", "neutralErtrag"],
    ["8838", "4851", "neutralErtrag"],
    ["2326", "6905", "neutralAufwand"],
    ["2347", "6918", "neutralAufwand"],
    ["2381", "6391", "neutralAufwand"],
    ["2385", "6875", "neutralAufwand"],
    ["2450", "6920", "neutralAufwand"],
    ["2490", "7390", "neutralAufwand"],
    ["2492", "7392", "neutralAufwand"],
    ["2520", "4960", "neutralErtrag"],
    ["2709", "4839", "neutralErtrag"],
    ["2710", "4910", "neutralErtrag"],
    ["2725", "4905", "neutralErtrag"],
    ["2732", "4925", "neutralErtrag"],
    ["2742", "4970", "neutralErtrag"],
    ["2744", "4980", "neutralErtrag"],
    ["2750", "4860", "neutralErtrag"],
    ["2764", "4992", "neutralErtrag"],
    ["2790", "7190", "neutralErtrag"],
    ["2285", "7690", "neutralAufwand"],
    // „Abschreibungen auf Finanzanlagen und auf Wertpapiere des Umlaufvermögens“ (SKR03 S. 24, SKR04 S. 27) gehören zum
    // Finanzergebnis (§ 275 Abs. 2 Nr. 12 HGB), nicht zum Betriebsergebnis; die Abschreibungen davor und danach bleiben
    ["4865", "6266", "abschreibungen"],
    ["4866", "7201", "neutralAufwand"],
    ["4870", "7200", "neutralAufwand"],
    ["4871", "7204", "neutralAufwand"],
    ["4872", "7208", "neutralAufwand"],
    ["4873", "7255", "neutralAufwand"],
    ["4874", "7250", "neutralAufwand"],
    ["4875", "7210", "neutralAufwand"],
    ["4876", "7214", "neutralAufwand"],
    ["4877", "7207", "neutralAufwand"],
    ["4878", "7217", "neutralAufwand"],
    ["4880", "6270", "abschreibungen"],
    // Zinsen
    ["2100", "7300", "zinsaufwand"],
    ["2118", "7318", "zinsaufwand"],
    ["2146", "7364", "zinsaufwand"],
    ["2600", "7000", "zinsertrag"],
    ["2650", "7100", "zinsertrag"],
    ["2686", "7144", "zinsertrag"],
    // Steuern vom Einkommen und Ertrag
    ["2200", "7600", "ertragsteuern"],
    ["2208", "7608", "ertragsteuern"],
    ["2255", "7649", "ertragsteuern"],
    // Leistung und kalkulatorische Kosten
    ["8970", "4815", "bestandsveraenderungen"],
    ["8990", "4820", "eigenleistungen"],
    ["2890", "6980", "kalkulatorisch"],
    ["4990", "6970", "sonstigeKosten"],
    // Betriebliche Erträge und Verwahrentgelt bleiben, wo sie sind; „Sonstige betriebliche Erträge“ und „Sonstige Erträge
    // betrieblich und regelmäßig“ stehen im SKR03 in Klasse 8 (S. 27), im SKR04 bei 4830 bis 4841 (S. 17)
    ["8590", "4940", "sonstigeErloese"],
    ["8603", "4830", "sonstigeErloese"],
    ["8605", "4835", "sonstigeErloese"],
    ["8609", "4841", "sonstigeErloese"],
    // Gleich benannt: SKR03 S. 27, SKR04 S. 17
    ["8649", "4834", "sonstigeErloese"], // „Sonstige Erträge betrieblich und regelmäßig 16 % USt“
    ["8640", "4836", "sonstigeErloese"], // „Sonstige Erträge betrieblich und regelmäßig 19 % USt“
    ["8606", "4832", "sonstigeErloese"], // „Sonstige betriebliche Erträge von verbundenen Unternehmen“
    ["8604", "4838", "sonstigeErloese"], // „Erstattete Vorsteuer anderer Länder“
    ["8625", "4842", "sonstigeErloese"], // „Sonstige betriebliche Erträge, steuerfrei z. B. § 4 Nr. 2 bis 7 UStG“
    ["4971", "6879", "sonstigeKosten"],
  ];
  it.each(PAARE)("SKR03 %s und SKR04 %s → %s", (skr03, skr04, erwartet) => {
    expect(kostenartOf("SKR03", skr03)).toBe(erwartet);
    expect(kostenartOf("SKR04", skr04)).toBe(erwartet);
  });

  // SKR03 2700 „Andere betriebs- und/oder periodenfremde (neutrale) sonstige Erträge“ (S. 17) hat im SKR04 kein gleich
  // benanntes Konto; SKR04 4830 und 4835 entsprechen SKR03 8603 und 8605 (oben)
  it("SKR03 2700 ist neutral", () => {
    expect(kostenartOf("SKR03", "2700")).toBe("neutralErtrag");
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
