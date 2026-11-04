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

const GII = "https://www.gesetze-im-internet.de";
const RECHENGROESSEN_2026 = `Sozialversicherungsrechengrößen-Verordnung 2026 vom 24.11.2025, BGBl. 2025 I Nr. 278 (${GII}/svbezgrv_2026/)`;
const MINIJOB_ZENTRALE_2026 =
  "Minijob-Zentrale, Abgaben & Steuern für Gewerbetreibende 2026 (https://www.minijob-zentrale.de/DE/fuer-gewerbetreibende/abgaben-und-steuern)";
const BANZ = "https://www.bundesanzeiger.de/pub/publication";

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
    bbgKvPv: `${RECHENGROESSEN_2026}, § 2 Abs. 2 (Jahresarbeitsentgeltgrenze nach § 6 Abs. 7 SGB V: 69.750 €, „umgerechnet auf den Monat … 5 812,50 Euro“), Beitragsbemessungsgrenze nach § 223 Abs. 3 SGB V und § 55 Abs. 2 SGB XI (${GII}/sgb_11/__55.html)`,
    bbgRvAv: `${RECHENGROESSEN_2026}, § 4 Abs. 1 Nr. 1 (101.400 € jährlich, „umgerechnet auf den Monat … 8 450 Euro“, ohne eigenen Wert für das Beitrittsgebiet); AV nach § 341 Abs. 4 SGB III (${GII}/sgb_3/__341.html)`,
    kv: `§ 241 SGB V: „Der allgemeine Beitragssatz beträgt 14,6 Prozent“ (${GII}/sgb_5/__241.html)`,
    kvZusatzDurchschnitt: `Bekanntmachung des BMG nach § 242a Abs. 2 SGB V vom 7.11.2025, BAnz AT 10.11.2025 B7: 2,9 % (${BANZ}/oUJYVk8GYRXybnb9Y4h/content/oUJYVk8GYRXybnb9Y4h/BAnz%20AT%2010.11.2025%20B7.pdf)`,
    pv: `§ 1 Abs. 1 Pflege-Beitragssatz-Anpassungsverordnung 2025 vom 20.12.2024: 3,6 % ab 1.1.2025 (${GII}/pbav_2025/__1.html); für 2026 bestätigt in der Bekanntmachung des Faktors F (BAnz AT 18.12.2025 B5)`,
    pvAnSachsen: `§ 58 Abs. 3 SGB XI: in Sachsen trägt der Beschäftigte 1 % allein, also (3,6 % − 1 %) / 2 + 1 % = 2,3 % (${GII}/sgb_11/__58.html)`,
    pvAgSachsen: `§ 58 Abs. 3 SGB XI: Arbeitgeber in Sachsen (3,6 % − 1 %) / 2 = 1,3 % (${GII}/sgb_11/__58.html)`,
    pvZuschlagKinderlos: `§ 55 Abs. 3 Satz 1 SGB XI: 0,6 Beitragssatzpunkte nach Vollendung des 23. Lebensjahres (${GII}/sgb_11/__55.html); trägt der Beschäftigte, § 58 Abs. 1 Satz 3 SGB XI`,
    pvAbschlagJeKind: `§ 55 Abs. 3 Satz 4 SGB XI: 0,25 Beitragssatzpunkte für jedes Kind ab dem zweiten bis zum fünften, solange es unter 25 ist (${GII}/sgb_11/__55.html)`,
    pvAbschlaegeHoechstens: `§ 55 Abs. 3 Satz 4 SGB XI: zweites bis fünftes Kind, also höchstens vier Abschläge (${GII}/sgb_11/__55.html)`,
    rv: `Bekanntmachung der Beitragssätze in der allgemeinen Rentenversicherung und der knappschaftlichen Rentenversicherung für das Jahr 2026 vom 24.11.2025, BGBl. 2025 I Nr. 291: „weiterhin … 18,6 Prozent“ (${GII}/rvbeitrsbek_2026/)`,
    av: `§ 341 Abs. 2 SGB III: „Der Beitragssatz beträgt 2,6 Prozent“ (${GII}/sgb_3/__341.html)`,
    insolvenzgeld: `§ 360 SGB III: „Der Umlagesatz beträgt 0,15 Prozent“ (${GII}/sgb_3/__360.html); abweichende Verordnungen nach § 361 SGB III gab es nur für 2022 bis 2024`,
    geringfuegigkeitsgrenze: `§ 8 Abs. 1a SGB IV (${GII}/sgb_4/__8.html): Mindestlohn 13,90 € × 130 / 3 = 602,33 €, auf volle Euro aufgerundet 603 €; bekannt gemacht vom BMAS, BAnz AT 20.11.2025 B1`,
    uebergangsbereichBis: `§ 20 Abs. 2 SGB IV: Arbeitsentgelte, „die regelmäßig 2 000 Euro im Monat nicht übersteigen“ (${GII}/sgb_4/__20.html)`,
    faktorF: `Bekanntmachung des BMAS vom 25.11.2025, BAnz AT 18.12.2025 B5: Gesamtsozialversicherungsbeitragssatz 42,3 %, Faktor F 0,6619 (${BANZ}/tEVvKJtcxc4VdUgfyAg/content/tEVvKJtcxc4VdUgfyAg/BAnz%20AT%2018.12.2025%20B5.pdf)`,
    minijobKv: `§ 249b Satz 1 SGB V: 13 % des Arbeitsentgelts (${GII}/sgb_5/__249b.html); ${MINIJOB_ZENTRALE_2026}`,
    minijobRvAg: `§ 168 Abs. 1 Nr. 1b SGB VI (15 %, Rest trägt der Versicherte) und § 172 Abs. 3 SGB VI bei Befreiung (${GII}/sgb_6/__168.html); ${MINIJOB_ZENTRALE_2026}`,
    minijobRvMindestbemessung: `§ 163 Abs. 8 SGB VI: „mindestens jedoch der Betrag in Höhe von 175 Euro“ (${GII}/sgb_6/__163.html)`,
    minijobPauschsteuer: `§ 40a Abs. 2 EStG: „Pauschsteuersatz in Höhe von insgesamt 2 Prozent“ (${GII}/estg/__40a.html)`,
    minijobU1: `${MINIJOB_ZENTRALE_2026}: 0,8 % (zum 1.1.2026 von 1,1 % gesenkt); Satzung der Knappschaft-Bahn-See, nicht im Gesetz`,
    minijobU2: `${MINIJOB_ZENTRALE_2026}: 0,22 %; Satzung der Knappschaft-Bahn-See, nicht im Gesetz`,
  },
};
