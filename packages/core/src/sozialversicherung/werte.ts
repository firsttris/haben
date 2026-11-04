import type { BasisPoints, Cents } from "../money.ts";

/**
 * Rechengrößen und Beitragssätze der Sozialversicherung für ein Kalenderjahr. Beträge je Monat in Cent, Sätze in
 * Basispunkten (1860 = 18,6 %), der Faktor F in Zehntausendsteln (6619 = 0,6619), wie ihn das BMAS auf vier
 * Dezimalstellen bekannt macht.
 */
export interface SvJahreswerte {
  /** Beitragsbemessungsgrenze Kranken- und Pflegeversicherung je Monat */
  bbgKvPv: Cents;
  /** Beitragsbemessungsgrenze allgemeine Renten- und Arbeitslosenversicherung je Monat, bundeseinheitlich */
  bbgRvAv: Cents;
  /** Allgemeiner Beitragssatz der Krankenversicherung ohne Zusatzbeitrag */
  kv: BasisPoints;
  /** Durchschnittlicher Zusatzbeitragssatz; nur für den Abgleich mit dem Faktor F, gerechnet wird mit dem der Kasse */
  kvZusatzDurchschnitt: BasisPoints;
  /** Beitragssatz der Pflegeversicherung */
  pv: BasisPoints;
  /** Anteil des Beschäftigten an der Pflegeversicherung in Sachsen (ohne Zuschlag und Abschläge) */
  pvAnSachsen: BasisPoints;
  /** Anteil des Arbeitgebers an der Pflegeversicherung in Sachsen */
  pvAgSachsen: BasisPoints;
  /** Beitragszuschlag für Kinderlose, trägt der Beschäftigte allein */
  pvZuschlagKinderlos: BasisPoints;
  /** Abschlag je Kind unter 25 ab dem zweiten Kind, nur beim Beschäftigten */
  pvAbschlagJeKind: BasisPoints;
  /** Höchstzahl der Abschläge (zweites bis fünftes Kind) */
  pvAbschlaegeHoechstens: number;
  /** Beitragssatz der allgemeinen Rentenversicherung */
  rv: BasisPoints;
  /** Beitragssatz der Arbeitslosenversicherung */
  av: BasisPoints;
  /** Umlagesatz für das Insolvenzgeld (U3) */
  insolvenzgeld: BasisPoints;
  /** Geringfügigkeitsgrenze je Monat; zugleich untere Grenze des Übergangsbereichs */
  geringfuegigkeitsgrenze: Cents;
  /** Obere Grenze des Übergangsbereichs je Monat */
  uebergangsbereichBis: Cents;
  /** Faktor F für den Übergangsbereich in Zehntausendsteln */
  faktorF: number;
  /** Pauschalbeitrag des Arbeitgebers zur Krankenversicherung im gewerblichen Minijob */
  minijobKv: BasisPoints;
  /** Pauschalbeitrag des Arbeitgebers zur Rentenversicherung im gewerblichen Minijob */
  minijobRvAg: BasisPoints;
  /** Mindestbeitragsbemessungsgrundlage der Rentenversicherung im Minijob je Monat */
  minijobRvMindestbemessung: Cents;
  /** Einheitliche Pauschsteuer im Minijob */
  minijobPauschsteuer: BasisPoints;
  /** Umlage U1 der Minijob-Zentrale */
  minijobU1: BasisPoints;
  /** Umlage U2 der Minijob-Zentrale */
  minijobU2: BasisPoints;
}

export type SvJahr = { jahr: number; werte: SvJahreswerte; quellen: Record<keyof SvJahreswerte, string> };

const RECHENGROESSEN_2026 = "Sozialversicherungsrechengrößen-Verordnung 2026 vom 24.11.2025, BGBl. 2025 I Nr. 278";
const MINIJOB_ZENTRALE_2026 =
  "Minijob-Zentrale, Abgaben & Steuern für Gewerbetreibende 2026 (https://www.minijob-zentrale.de/DE/fuer-gewerbetreibende/abgaben-und-steuern)";

/**
 * Werte 2026. Jede Zahl ist mit Quelle belegt; die Sekundärquellen (Kassen, Minijob-Zentrale) stimmen mit den
 * genannten Vorschriften überein. Der Abgleich mit dem PAP 2026 der Lohnsteuer steht in `werte.test.ts`.
 */
export const SV_2026: SvJahr = {
  jahr: 2026,
  werte: {
    bbgKvPv: 5812_50,
    bbgRvAv: 8450_00,
    kv: 1460,
    kvZusatzDurchschnitt: 290,
    pv: 360,
    pvAnSachsen: 230,
    pvAgSachsen: 130,
    pvZuschlagKinderlos: 60,
    pvAbschlagJeKind: 25,
    pvAbschlaegeHoechstens: 4,
    rv: 1860,
    av: 260,
    insolvenzgeld: 15,
    geringfuegigkeitsgrenze: 603_00,
    uebergangsbereichBis: 2000_00,
    faktorF: 6619,
    minijobKv: 1300,
    minijobRvAg: 1500,
    minijobRvMindestbemessung: 175_00,
    minijobPauschsteuer: 200,
    minijobU1: 80,
    minijobU2: 22,
  },
  quellen: {
    bbgKvPv: `${RECHENGROESSEN_2026}, § 2 Abs. 2 (69.750 € im Jahr) mit § 223 Abs. 3 SGB V und § 55 Abs. 2 SGB XI`,
    bbgRvAv: `${RECHENGROESSEN_2026}, § 4 Abs. 1 (101.400 € im Jahr), seit 2025 ohne eigenen Wert für das Beitrittsgebiet; § 341 Abs. 4 SGB III`,
    kv: "§ 241 SGB V (14,6 %)",
    kvZusatzDurchschnitt: "Bekanntmachung des BMG nach § 242a Abs. 2 SGB V vom 7.11.2025, BAnz AT 10.11.2025 B7 (2,9 %)",
    pv: "§ 1 Pflege-Beitragssatz-Anpassungsverordnung 2025 vom 20.12.2024 (3,6 % ab 1.1.2025), für 2026 unverändert",
    pvAnSachsen: "§ 58 Abs. 3 SGB XI: in Sachsen trägt der Beschäftigte 0,5 Punkte mehr als die Hälfte (1,8 % + 0,5 % = 2,3 %)",
    pvAgSachsen: "§ 58 Abs. 3 SGB XI: Arbeitgeber in Sachsen 3,6 % − 2,3 % = 1,3 %",
    pvZuschlagKinderlos: "§ 55 Abs. 3 SGB XI (0,6 Beitragssatzpunkte, ab dem vollendeten 23. Lebensjahr), § 58 Abs. 1 SGB XI (trägt der Beschäftigte)",
    pvAbschlagJeKind: "§ 55 Abs. 3 SGB XI (0,25 Beitragssatzpunkte je Kind unter 25 ab dem zweiten Kind)",
    pvAbschlaegeHoechstens: "§ 55 Abs. 3 SGB XI (bis zum fünften Kind, höchstens 1,0 Beitragssatzpunkte)",
    rv: "Bekanntmachung der Beitragssätze in der allgemeinen Rentenversicherung und der knappschaftlichen Rentenversicherung für das Jahr 2026 vom 24.11.2025, BGBl. 2025 I Nr. 291 (18,6 %)",
    av: "§ 341 Abs. 2 SGB III (2,6 %)",
    insolvenzgeld: "§ 360 SGB III (0,15 %); für 2026 keine abweichende Verordnung nach § 361 SGB III",
    geringfuegigkeitsgrenze:
      "§ 8 Abs. 1a SGB IV mit Mindestlohn 13,90 € (13,90 € · 130 / 3 = 602,33 €, aufgerundet), Bekanntmachung des BMAS, BAnz AT 20.11.2025 B1 (603 €)",
    uebergangsbereichBis: "§ 20 Abs. 2 SGB IV (2.000 €)",
    faktorF:
      "Bekanntmachung des BMAS vom 25.11.2025 nach § 20 Abs. 2a SGB IV, BAnz AT 18.12.2025 B5 (Gesamtsozialversicherungsbeitragssatz 42,3 %, Faktor F 0,6619)",
    minijobKv: `§ 249b SGB V (13 %); ${MINIJOB_ZENTRALE_2026}`,
    minijobRvAg: `§ 172 Abs. 3 SGB VI (15 %); ${MINIJOB_ZENTRALE_2026}`,
    minijobRvMindestbemessung:
      "§ 163 Abs. 8 SGB VI (175 €); Minijob-Zentrale, FAQ „Kann ich von jedem noch so kleinen Gehalt in die Rentenversicherung einzahlen?“",
    minijobPauschsteuer: `§ 40a Abs. 2 EStG (2 %); ${MINIJOB_ZENTRALE_2026}`,
    minijobU1: `${MINIJOB_ZENTRALE_2026} (0,8 %, zum 1.1.2026 von 1,1 % gesenkt)`,
    minijobU2: `${MINIJOB_ZENTRALE_2026} (0,22 %)`,
  },
};
