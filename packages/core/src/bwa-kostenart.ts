import { postenOf, type GuvPosten } from "./hgb.ts";
import type { Kontenrahmen } from "./posting.ts";

/*
 * Kostenart eines Erfolgskontos für die BWA (#1380): die Zeilen der Kurzfristigen Erfolgsrechnung (DATEV BWA-Form 01) und
 * der Einnahmen-Ausgaben-BWA (Form 43) fassen Kostenarten unterschiedlich zusammen, die Kostenart ist beiden gemeinsam.
 *
 * Quelle der Bereiche sind die Kontengruppen des DATEV-Kontenrahmens 2026 (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175):
 * Raumkosten, Versicherungen und Beiträge, Fahrzeugkosten, Werbe- und Reisekosten, Kosten der Warenabgabe, Reparaturen und
 * Instandhaltung stehen dort als eigene Gruppen. Welche Konten DATEV intern welcher BWA-Zeile zuordnet, ist nicht veröffentlicht; die
 * Gruppen des Kontenrahmens sind die nächste öffentliche Quelle (Musterauswertung BWA, DATEV 2016, nennt nur die Zeilen).
 *
 * Grundlage ist der GuV-Posten aus hgb.ts (`postenOf`): Ein Konto ohne GuV-Posten ist kein Erfolgskonto und hat keine
 * Kostenart. Die Bereiche unten verfeinern den Posten nur; was in keinem Bereich liegt, bekommt die Kostenart seines Postens.
 *
 * Neutral sind die Abgrenzungskonten der Klasse 2 im SKR03 (betriebsfremd, periodenfremd, außergewöhnlich), darunter
 * Forderungsverluste, nicht abziehbare Vorsteuer und Kursdifferenzen (§ 277 Abs. 5 Satz 2 HGB verlangt die Erträge und
 * Aufwendungen aus der Währungsumrechnung gesondert). Der SKR04 hat keine solche Klasse; dort sind die gleich benannten Konten
 * neutral, ebenso die Abschreibungen auf Finanzanlagen und auf Wertpapiere des Umlaufvermögens: Sie gehören zum Finanzergebnis
 * (§ 275 Abs. 2 Nr. 12 HGB), nicht zum Betriebsergebnis. Zinsen und Steuern vom Einkommen und Ertrag haben in Form 01 eigene
 * Zeilen.
 */

export type Kostenart =
  | "erloese"
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
  | "bestandsveraenderungen"
  | "eigenleistungen"
  | "zinsaufwand"
  | "zinsertrag"
  | "neutralAufwand"
  | "neutralErtrag"
  | "kalkulatorisch"
  | "ertragsteuern";

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

/** Neutral bzw. Zinsen: Ob Ertrag oder Aufwand, sagt der GuV-Posten des Kontos */
type Seitenart = "neutral" | "zinsen";

type Bereich = readonly [von: string, bis: string, kostenart: Kostenart | Seitenart];

/**
 * Bereiche des DATEV-Kontenrahmens 2026 für die Kostenarten, die SKR03 und SKR04 gleich gliedern (Test über gleich benannte
 * Konten in bwa-kostenart.test.ts). Seite und Kontengruppe bzw. Konto stehen je Bereich dabei.
 */
const BEREICHE: Record<Kontenrahmen, readonly Bereich[]> = {
  // DATEV-Kontenrahmen SKR 03 2026, Art.-Nr. 11174
  SKR03: [
    // S. 13, „Sonstige betriebliche Aufwendungen“ 2004/2007 (Verschmelzung, Restrukturierung), „Betriebsfremde und
    // periodenfremde Aufwendungen“ 2020, Aufwendungen aus Übergangsvorschriften des BilMoG
    ["2000", "2099", "neutral"],
    ["2100", "2149", "zinsen"], // S. 13 f., „Zinsen und ähnliche Aufwendungen“
    // S. 14, 2150/2151 „Aufwendungen aus der Währungsumrechnung“, 2166 „Aufwendungen aus Bewertung Finanzmittelfonds“,
    // 2170 bis 2176 „Nicht abziehbare Vorsteuer“
    ["2150", "2199", "neutral"],
    ["2200", "2284", "ertragsteuern"], // S. 14, „Steuern vom Einkommen und Ertrag“ 2200 bis 2283
    ["2285", "2299", "neutral"], // S. 14, 2285 bis 2289 Steuernachzahlungen und -erstattungen Vorjahre für sonstige Steuern
    ["2300", "2374", "neutral"], // S. 14 f., „Sonstige Aufwendungen“ 2300 bis 2350, mit den Anlagenabgängen
    // 2375 „Grundsteuer“ (S. 15) bleibt bei den betrieblichen Steuern wie SKR04 7680
    // S. 15, 2380 bis 2390 „Zuwendungen, Spenden“, 2400 bis 2409 „Forderungsverluste“, 2430 bis 2451 Forderungsverluste
    // „soweit unüblich hoch“ und Wertberichtigungen, 2490 bis 2494 Verlustübernahme und abgeführte Gewinne
    ["2376", "2499", "neutral"],
    ["2500", "2599", "neutral"], // S. 16, „Betriebsfremde und periodenfremde Erträge“
    ["2600", "2659", "zinsen"], // S. 16 f., „Zinserträge“: Beteiligungen, Wertpapiere, 2650 „Sonstige Zinsen und ähnliche Erträge“
    ["2660", "2669", "neutral"], // S. 17, 2660/2661 „Erträge aus der Währungsumrechnung“, 2666 Bewertung Finanzmittelfonds
    ["2670", "2699", "zinsen"], // S. 17, „Zinserträge“: 2680 bis 2689 „Zinsähnliche Erträge“
    // S. 17 f., „Sonstige Erträge“ 2700 bis 2764 (auch 2750 „Grundstückserträge“), 2790 bis 2794 Erträge aus Verlustübernahme;
    // 2700 heißt „Andere betriebs- und/oder periodenfremde (neutrale) sonstige Erträge“, 2705 und 2707 sind reserviert („R“).
    // Die betrieblichen sonstigen Erträge 8603, 8605 und 8609 (S. 27) entsprechen SKR04 4830, 4835 und 4841
    ["2700", "2799", "neutral"],
    ["2890", "2900", "kalkulatorisch"], // S. 18, „Verrechnete kalkulatorische Kosten“
    ["3100", "3199", "fremdleistungen"], // S. 19, 3100 „Fremdleistungen“
    // S. 20, „Aufwendungen für Roh-, Hilfs- und Betriebsstoffe und für bezogene Waren“: 3600 bis 3669 „Nicht abziehbare
    // Vorsteuer“ wie 2170 bis 2176
    ["3600", "3669", "neutral"],
    ["4200", "4299", "raum"], // S. 22, 4200 „Raumkosten“ bis 4290 „Grundstücksaufwendungen“
    ["4300", "4306", "neutral"], // S. 23, 4300 bis 4306 „Nicht abziehbare Vorsteuer“ wie 2170 bis 2176
    ["4320", "4339", "ertragsteuern"], // S. 23, 4320 „Gewerbesteuer“, GuV-Posten „Steuern vom Einkommen und vom Ertrag“
    ["4360", "4399", "versicherungen"], // S. 23, 4360 „Versicherungen“, 4380 „Beiträge“, 4390 „Sonstige Abgaben“
    ["4500", "4500", "kfz"], // S. 23, 4500 „Fahrzeugkosten“; 4510 „Kfz-Steuer“ bleibt bei den Steuern („Kfz-Kosten (o. St.)“)
    ["4520", "4599", "kfz"], // S. 23, 4520 „Fahrzeug-Versicherungen“ bis 4595 „Fremdfahrzeugkosten“
    ["4600", "4699", "werbeReise"], // S. 23, 4600 „Werbekosten“ bis 4681 „Verpflegungsmehraufwendungen“
    ["4700", "4799", "warenabgabe"], // S. 23, 4700 „Kosten der Warenabgabe“
    ["4800", "4809", "instandhaltung"], // S. 24, 4800 „Reparaturen und Instandhaltungen“; 4810 „Mietleasing“ nicht
    // S. 24, „Abschreibungen auf Finanzanlagen und auf Wertpapiere des Umlaufvermögens“ 4866 bis 4878: Finanzergebnis
    // (§ 275 Abs. 2 Nr. 12 HGB), nicht Betriebsergebnis; 4880 „Abschreibungen auf … Umlaufvermögen“ (Nr. 7 b) nicht
    ["4866", "4878", "neutral"],
    // S. 28 f., 8800 bis 8819 „Erlöse aus Verkäufen …“ bei Buchverlust (GuV-Posten „Sonstige betriebliche Aufwendungen“),
    // 8820 bis 8839 bei Buchgewinn („Sonstige betriebliche Erträge“): neutral wie der Restbuchwert 2310 bis 2318
    ["8800", "8839", "neutral"],
    // S. 29, „Erhöhung oder Verminderung des Bestandes an fertigen und unfertigen Erzeugnissen“ 8960 bis 8980
    ["8960", "8989", "bestandsveraenderungen"],
    ["8990", "8995", "eigenleistungen"], // S. 29, „Andere aktivierte Eigenleistungen“
  ],
  // DATEV-Kontenrahmen SKR 04 2026, Art.-Nr. 11175
  SKR04: [
    ["4800", "4819", "bestandsveraenderungen"], // S. 17, „Bestandsveränderungen“ wie SKR03 8960 bis 8980
    ["4820", "4829", "eigenleistungen"], // S. 17, „Andere aktivierte Eigenleistungen“ wie SKR03 8990 bis 8995
    // S. 17, 4830 bis 4838 nicht neutral: 4830, 4835 wie SKR03 8603, 8605, 4834/4836 wie 8649/8640 (4837 reserviert, „R“);
    // 4839 „Sonstige Erträge unregelmäßig“ wie SKR03 2709, 4840 „Erträge aus der Währungsumrechnung“ wie SKR03 2660
    ["4839", "4840", "neutral"],
    ["4843", "4843", "neutral"], // S. 17, „Erträge aus Bewertung Finanzmittelfonds“ wie SKR03 2666
    // S. 17, 4844 bis 4852 „Erlöse aus Verkäufen …“ bei Buchgewinn wie SKR03 8820 bis 8839, dazwischen 4847 „Erträge aus der
    // Währungsumrechnung (nicht § 256a HGB)“ wie SKR03 2661
    ["4844", "4852", "neutral"],
    ["4855", "4858", "neutral"], // S. 17, „Anlagenabgänge“ (Restbuchwert bei Buchgewinn) wie SKR03 2315 bis 2318
    ["4860", "4864", "neutral"], // S. 17, „Grundstückserträge“ wie SKR03 2750 bis 2752
    // S. 17 f., 4904 bis 4938 Abgänge, Zuschreibungen, Herabsetzungen und Auflösungen wie SKR03 2710 bis 2741
    ["4900", "4939", "neutral"],
    // S. 18, 4960 „Periodenfremde Erträge“ wie SKR03 2520, 4970 bis 4992 wie SKR03 2742 bis 2764
    ["4960", "4999", "neutral"],
    // S. 19, „Aufwendungen für Roh-, Hilfs- und Betriebsstoffe und für bezogene Waren“: 5600 bis 5669 „Nicht abziehbare
    // Vorsteuer“ wie SKR03 3600 bis 3669
    ["5600", "5669", "neutral"],
    ["5900", "5999", "fremdleistungen"], // S. 20, 5900 „Fremdleistungen“
    ["6280", "6291", "neutral"], // S. 22, Forderungsverluste „soweit unüblich hoch“ wie SKR03 2430 bis 2441
    // S. 23, 6305 „Raumkosten“ bis 6350 „Grundstücksaufwendungen, betrieblich“ wie SKR03 4200 bis 4299
    ["6305", "6351", "raum"],
    ["6352", "6352", "neutral"], // S. 23, „Sonstige Grundstücksaufwendungen (neutral)“ wie SKR03 2350
    ["6390", "6399", "neutral"], // S. 23, „Zuwendungen, Spenden“ wie SKR03 2380 bis 2390
    // S. 23, 6400 „Versicherungen“ bis 6436/6437 Verspätungszuschläge; 6440 „Ausgleichsabgabe“ wie SKR03 4139 nicht
    ["6400", "6439", "versicherungen"],
    // S. 23, 6450 „Reparaturen und Instandhaltung“; 6498 „Mietleasing“ wie SKR03 4810 nicht
    ["6450", "6497", "instandhaltung"],
    ["6500", "6599", "kfz"], // S. 23, 6500 „Fahrzeugkosten“; 7685 „Kfz-Steuer“ (S. 28) bleibt bei den Steuern
    ["6600", "6699", "werbeReise"], // S. 23, 6600 „Werbekosten“ bis 6691 „Verpflegungsmehraufwendungen“
    ["6700", "6799", "warenabgabe"], // S. 24, 6700 „Kosten der Warenabgabe“
    // S. 24, 6860 bis 6871 „Nicht abziehbare Vorsteuer“ wie SKR03 2170 bis 2176, 6875/6876 Aufsichtsratsvergütungen wie
    // SKR03 2385/2386; 6879 „Verwahrentgelt“ wie SKR03 4971 nicht
    ["6860", "6876", "neutral"],
    ["6880", "6883", "neutral"], // S. 24, „Aufwendungen aus der Währungsumrechnung“ und Bewertung wie SKR03 2150 bis 2166
    ["6884", "6892", "neutral"], // S. 25, „Erlöse aus Verkäufen …“ bei Buchverlust wie SKR03 8800 bis 8819
    // S. 25, 6895 bis 6908 Anlagenabgänge und Abgänge des Umlaufvermögens wie SKR03 2310 bis 2328; 6910 „Abschreibungen
    // auf Umlaufvermögen“ wie SKR03 4880 nicht
    ["6895", "6908", "neutral"],
    // S. 25, 6918 bis 6929 Einstellungen in Wertberichtigungen und steuerliche Rücklagen wie SKR03 2339 bis 2451,
    // 6930 bis 6938 „Forderungsverluste“ wie SKR03 2400 bis 2408
    ["6918", "6939", "neutral"],
    ["6960", "6969", "neutral"], // S. 25, 6960 „Periodenfremde Aufwendungen“ wie SKR03 2020, 6968 wie SKR03 2308
    ["6980", "6989", "kalkulatorisch"], // S. 25, „Verrechnete kalkulatorische Kosten“ wie SKR03 2890 bis 2895
    ["7000", "7189", "zinsen"], // S. 26, Erträge aus Beteiligungen und Wertpapieren, „Sonstige Zinsen“ wie SKR03 2600 bis 2689
    ["7190", "7199", "neutral"], // S. 26, „Erträge aus Verlustübernahme“ wie SKR03 2790 bis 2794
    // S. 27, „Abschreibungen auf Finanzanlagen und auf Wertpapiere des Umlaufvermögens“ wie SKR03 4866 bis 4878
    ["7200", "7255", "neutral"],
    ["7300", "7389", "zinsen"], // S. 27, „Zinsen und ähnliche Aufwendungen“ wie SKR03 2100 bis 2149
    // S. 28, Verlustübernahme und abgeführte Gewinne wie SKR03 2490 bis 2494, 7451 Verschmelzung wie SKR03 2504, 7551/7553
    // wie SKR03 2004/2007
    ["7390", "7599", "neutral"],
    // S. 28, „Steuern vom Einkommen und Ertrag“ 7600 bis 7649 mit 7610 „Gewerbesteuer“ wie SKR03 2200 bis 2283 und 4320
    ["7600", "7649", "ertragsteuern"],
    ["7690", "7699", "neutral"], // S. 28, 7690 bis 7694 Vorjahre für sonstige Steuern wie SKR03 2285 bis 2289
  ],
};

const ERTRAG: ReadonlySet<GuvPosten> = new Set(["umsatzerloese", "sonstigeErtraege"]);

/**
 * Kostenart eines Kontos; null, wenn es kein Erfolgskonto ist (Bilanz, nicht zugeordnet). Ein eigenes Sachkonto (#270) löst
 * der Aufrufer vorher auf das Konto seiner Elternkategorie auf (`resolveOwnAccount`): Seine Nummer darf in der ganzen
 * Aufwandsklasse liegen und sagte hier sonst die falsche Kostenart.
 */
export function kostenartOf(kontenrahmen: Kontenrahmen, account: string): Kostenart | null {
  const posten = postenOf(kontenrahmen, account);
  if (posten === null || posten.startsWith("aktiva.") || posten.startsWith("passiva.")) return null;
  const art = BEREICHE[kontenrahmen].find(([von, bis]) => account >= von && account <= bis)?.[2] ?? JE_POSTEN[posten as GuvPosten];
  const ertrag = ERTRAG.has(posten as GuvPosten);
  if (art === "neutral") return ertrag ? "neutralErtrag" : "neutralAufwand";
  if (art === "zinsen") return ertrag ? "zinsertrag" : "zinsaufwand";
  return art;
}
