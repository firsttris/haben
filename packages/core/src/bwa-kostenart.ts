import { postenOf, type GuvPosten } from "./hgb.ts";
import type { Kontenrahmen } from "./posting.ts";

/*
 * Kostenart eines Erfolgskontos für die BWA (#1380): die Zeilen der Kurzfristigen Erfolgsrechnung (DATEV BWA-Form 01) und
 * der Einnahmen-Ausgaben-BWA (Form 43) fassen Kostenarten unterschiedlich zusammen, die Kostenart ist beiden gemeinsam.
 *
 * Quelle der Bereiche sind die Kontengruppen des DATEV-Kontenrahmens 2026 (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175):
 * Raumkosten, Versicherungen und Beiträge, Fahrzeugkosten, Werbe- und Reisekosten, Kosten der Warenabgabe, Reparaturen und
 * Instandhaltung stehen dort als eigene Gruppen, die Zinsen, die neutralen Aufwendungen und Erträge und die Steuern vom
 * Einkommen und Ertrag ebenso. Welche Konten DATEV intern welcher BWA-Zeile zuordnet, ist nicht veröffentlicht; die
 * Gruppen des Kontenrahmens sind die nächste öffentliche Quelle (Musterauswertung BWA, DATEV 2016, nennt nur die Zeilen).
 *
 * Grundlage ist der GuV-Posten aus hgb.ts (`postenOf`): Ein Konto ohne GuV-Posten ist kein Erfolgskonto und hat keine
 * Kostenart. Die Bereiche unten verfeinern den Posten nur; was in keinem Bereich liegt, bekommt die Kostenart seines Postens.
 */

export type Kostenart =
  | "erloese"
  | "bestandsveraenderung"
  | "eigenleistungen"
  | "sonstigeErloese"
  | "material"
  | "fremdleistungen"
  | "personal"
  | "raum"
  | "betrieblicheSteuern"
  | "versicherungen"
  | "kfz"
  | "werbeReise"
  | "warenabgabe"
  | "abschreibungen"
  | "instandhaltung"
  | "sonstigeKosten"
  | "zinsaufwand"
  | "neutralerAufwand"
  | "zinsertrag"
  | "neutralerErtrag"
  | "verrechneteKalkulatorischeKosten"
  | "steuernEinkommen";

/** Kostenart, wenn kein Bereich unten greift: je GuV-Posten (§ 275 Abs. 5 HGB) */
const JE_POSTEN: Record<GuvPosten, Kostenart> = {
  umsatzerloese: "erloese",
  sonstigeErtraege: "sonstigeErloese",
  materialaufwand: "material",
  personalaufwand: "personal",
  abschreibungen: "abschreibungen",
  sonstigeAufwendungen: "sonstigeKosten",
  steuern: "betrieblicheSteuern",
};

/** „neutral“ und „zinsen“ nehmen die Seite vom GuV-Posten des Kontos: Ertrag oder Aufwand */
type BereichArt = Exclude<Kostenart, "neutralerAufwand" | "neutralerErtrag" | "zinsaufwand" | "zinsertrag"> | "neutral" | "zinsen";
type Bereich = readonly [von: string, bis: string, art: BereichArt];

/** Bereiche des DATEV-Kontenrahmens 2026, aufsteigend; ein Konto nimmt den ersten passenden */
const BEREICHE: Record<Kontenrahmen, readonly Bereich[]> = {
  SKR03: [
    // Klasse 2: Abgrenzungskonten (neutrale Aufwendungen und Erträge)
    ["2000", "2099", "neutral"],
    ["2100", "2149", "zinsen"],
    ["2150", "2199", "neutral"],
    // bis 2283 Steuern vom Einkommen und Ertrag (auch Gewerbesteuer der Vorjahre), ab 2285 sonstige Steuern der Vorjahre
    ["2200", "2284", "steuernEinkommen"],
    ["2285", "2289", "betrieblicheSteuern"],
    ["2300", "2374", "neutral"],
    ["2375", "2375", "betrieblicheSteuern"],
    ["2376", "2499", "neutral"],
    ["2500", "2649", "neutral"],
    ["2650", "2689", "zinsen"],
    // 2750 bis 2754 und 2764 sind Umsatzerlöse (Grundstückserträge), sie bleiben beim Posten
    ["2690", "2749", "neutral"],
    ["2755", "2763", "neutral"],
    ["2765", "2889", "neutral"],
    ["2890", "2899", "verrechneteKalkulatorischeKosten"],
    // Klasse 3: Wareneingang, 3100 bis 3199 Fremdleistungen
    ["3100", "3199", "fremdleistungen"],
    // Klasse 4: betriebliche Aufwendungen
    ["4200", "4299", "raum"],
    ["4320", "4320", "steuernEinkommen"],
    ["4340", "4355", "betrieblicheSteuern"],
    ["4360", "4399", "versicherungen"],
    ["4500", "4500", "kfz"],
    ["4510", "4510", "betrieblicheSteuern"],
    ["4520", "4599", "kfz"],
    ["4600", "4699", "werbeReise"],
    ["4700", "4799", "warenabgabe"],
    ["4800", "4809", "instandhaltung"],
    // Abschreibungen auf Finanzanlagen und Wertpapiere sind nicht betrieblich
    ["4866", "4878", "neutral"],
    // Klasse 8: Erlöse; Anlagenverkäufe neutral, Bestandsveränderungen und aktivierte Eigenleistungen eigene Zeilen
    ["8800", "8899", "neutral"],
    ["8960", "8989", "bestandsveraenderung"],
    ["8990", "8999", "eigenleistungen"],
  ],
  SKR04: [
    // Klasse 4: Erlöse; Bestandsveränderungen und aktivierte Eigenleistungen eigene Zeilen
    ["4800", "4819", "bestandsveraenderung"],
    ["4820", "4829", "eigenleistungen"],
    // Anlagenverkäufe, Zuschreibungen, Auflösungen und periodenfremde Erträge neutral; Sachbezüge bleiben betrieblich
    ["4844", "4858", "neutral"],
    ["4900", "4939", "neutral"],
    ["4960", "4969", "neutral"],
    // Klasse 5: Materialaufwand, 5900 bis 5999 Fremdleistungen
    ["5900", "5999", "fremdleistungen"],
    // Klasse 6: betriebliche Aufwendungen
    ["6305", "6389", "raum"],
    ["6390", "6399", "neutral"],
    ["6400", "6449", "versicherungen"],
    ["6450", "6497", "instandhaltung"],
    ["6500", "6599", "kfz"],
    ["6600", "6699", "werbeReise"],
    ["6700", "6799", "warenabgabe"],
    ["6884", "6909", "neutral"],
    ["6918", "6969", "neutral"],
    ["6980", "6989", "verrechneteKalkulatorischeKosten"],
    // Klasse 7: Erträge aus Beteiligungen und Zinsen, Zinsaufwand, Steuern
    ["7000", "7099", "neutral"],
    ["7100", "7149", "zinsen"],
    ["7150", "7199", "neutral"],
    ["7200", "7299", "neutral"],
    ["7300", "7365", "zinsen"],
    ["7366", "7599", "neutral"],
    ["7600", "7649", "steuernEinkommen"],
    ["7650", "7699", "betrieblicheSteuern"],
    ["7800", "8000", "neutral"],
  ],
};

/**
 * Kostenart eines Kontos; null, wenn es kein Erfolgskonto ist (Bilanz, nicht zugeordnet). Ein eigenes Sachkonto (#270) löst
 * der Aufrufer vorher auf das Konto seiner Elternkategorie auf (`resolveOwnAccount`): Seine Nummer darf in der ganzen
 * Aufwandsklasse liegen und sagte hier sonst die falsche Kostenart.
 */
export function kostenartOf(kontenrahmen: Kontenrahmen, account: string): Kostenart | null {
  const posten = postenOf(kontenrahmen, account);
  if (posten === null || posten.startsWith("aktiva.") || posten.startsWith("passiva.")) return null;
  const bereich = BEREICHE[kontenrahmen].find(([von, bis]) => account >= von && account <= bis);
  if (!bereich) return JE_POSTEN[posten as GuvPosten];
  const ertrag = posten === "umsatzerloese" || posten === "sonstigeErtraege";
  if (bereich[2] === "neutral") return ertrag ? "neutralerErtrag" : "neutralerAufwand";
  if (bereich[2] === "zinsen") return ertrag ? "zinsertrag" : "zinsaufwand";
  return bereich[2];
}
