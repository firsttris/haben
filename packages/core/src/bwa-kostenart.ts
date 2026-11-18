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
  | "sonstigeKosten";

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

type Bereich = readonly [von: string, bis: string, kostenart: Kostenart];

/**
 * Bereiche des DATEV-Kontenrahmens 2026 für die Kostenarten der betrieblichen Aufwendungen, die SKR03 und SKR04 gleich
 * gliedern. Neutrale Aufwendungen und Erträge, Zinsen und die Steuern vom Einkommen und Ertrag braucht erst die
 * Kurzfristige Erfolgsrechnung (Form 01); bis dahin stehen sie bei ihrem GuV-Posten.
 */
const BEREICHE: Record<Kontenrahmen, readonly Bereich[]> = {
  SKR03: [
    ["3100", "3199", "fremdleistungen"],
    ["4200", "4299", "raum"],
    ["4360", "4399", "versicherungen"],
    ["4500", "4500", "kfz"],
    // 4510 Kfz-Steuer bleibt bei den Steuern: DATEV zeigt „Kfz-Kosten (o. St.)“
    ["4520", "4599", "kfz"],
    ["4600", "4699", "werbeReise"],
    ["4700", "4799", "warenabgabe"],
    ["4800", "4809", "instandhaltung"],
  ],
  SKR04: [
    ["5900", "5999", "fremdleistungen"],
    // bis 6351 wie SKR03 4200 bis 4299; 6352 „Sonstige Grundstücksaufwendungen (neutral)“ wie SKR03 2350 nicht
    ["6305", "6351", "raum"],
    // ohne 6440 Ausgleichsabgabe, im SKR03 4139 bei den sonstigen Aufwendungen
    ["6400", "6439", "versicherungen"],
    // ohne 6498 Mietleasing, im SKR03 4810 bei den sonstigen Aufwendungen
    ["6450", "6497", "instandhaltung"],
    ["6500", "6599", "kfz"],
    ["6600", "6699", "werbeReise"],
    ["6700", "6799", "warenabgabe"],
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
  return BEREICHE[kontenrahmen].find(([von, bis]) => account >= von && account <= bis)?.[2] ?? JE_POSTEN[posten as GuvPosten];
}
