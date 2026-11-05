import type { BasisPoints, Cents } from "../money.ts";
import type { SvBeitraege } from "../sozialversicherung/index.ts";
import type { Bundesland } from "../steuernummer.ts";

/**
 * Beschäftigungsarten, die Haben abrechnet, in Stufen nach Risiko (docs/lohn-plan.md, „Vorgehen“):
 * A) Gesellschafter-Geschäftsführer ohne Sozialversicherungspflicht, nur Lohnsteuer;
 * B) Minijob im gewerblichen Bereich mit Pauschsteuer;
 * C) sozialversicherungspflichtig Beschäftigte mit laufendem Monatsgehalt, bis ein echter Fall gegen ein Lohnprogramm
 *    gegengerechnet ist nur als „Entwurf, gegenprüfen“.
 */
export const BESCHAEFTIGUNGSARTEN = {
  ggf: "Gesellschafter-Geschäftsführer ohne SV-Pflicht",
  minijob: "Minijob (geringfügig entlohnt)",
  beschaeftigt: "Sozialversicherungspflichtig beschäftigt",
} as const;

export type Beschaeftigungsart = keyof typeof BESCHAEFTIGUNGSARTEN;

/**
 * Kirchensteuermerkmale, die Haben rechnet, mit den Abkürzungen der ELStAM. Andere Religionsgemeinschaften erhebt nicht
 * jedes Land über die Lohnsteuer oder zu anderen Sätzen; sie rechnet Haben nicht.
 */
export const KONFESSIONEN = {
  ev: "evangelisch",
  rk: "römisch-katholisch",
  lt: "evangelisch-lutherisch",
  rf: "evangelisch-reformiert",
  ak: "altkatholisch",
} as const;

export type Konfession = keyof typeof KONFESSIONEN;

/** Krankenversicherung: gesetzlich mit dem Zusatzbeitrag der Kasse, oder privat mit dem Monatsbeitrag zur Basisabsicherung */
export type LohnKrankenversicherung =
  | { art: "gesetzlich"; zusatzbeitrag: BasisPoints }
  | {
      art: "privat";
      /** Beiträge zur privaten Basiskranken- und Pflege-Pflichtversicherung im Monat (PKPV im PAP) */
      basisbeitrag: Cents;
      /** Zuschuss des Arbeitgebers dazu im Monat */
      arbeitgeberzuschuss: Cents;
    };

/** Was die Abrechnung aus den Stammdaten eines Mitarbeiters braucht */
export interface LohnStammdaten {
  art: Beschaeftigungsart;
  /** Vereinbartes Monatsgehalt in Cent: das regelmäßige Entgelt der Beschäftigung */
  monatsgehalt: Cents;
  /** Beginn und Ende der Beschäftigung, JJJJ-MM-TT */
  eintritt: string;
  austritt: string | null;
  steuerklasse: 1 | 2 | 3 | 4 | 5 | 6;
  /** Faktor im Faktorverfahren in Tausendsteln; 1000 heißt ohne */
  faktor: number;
  /** Zahl der Kinderfreibeträge in Tausendsteln (0,5 = 500) */
  kinderfreibetraege: number;
  /** Kirchensteuermerkmal, null ohne Kirchensteuerpflicht */
  konfession: Konfession | null;
  kv: LohnKrankenversicherung;
  /** Merkmale der Pflegeversicherung (§ 55 Abs. 3 SGB XI) */
  pflege: { kinderlosenzuschlag: boolean; kinderUnter25: number };
  /** Umlagesätze der Krankenkasse; `u1` null ohne Teilnahme am U1-Verfahren */
  umlagen: { u1: BasisPoints | null; u2: BasisPoints };
  /** Nur im Minijob */
  minijob: { rvBefreit: boolean; pauschsteuer: boolean };
}

export interface LohnabrechnungEingabe {
  jahr: number;
  /** 1 bis 12 */
  monat: number;
  stammdaten: LohnStammdaten;
  /** Bundesland der Betriebsstätte: Kirchensteuersatz und Pflegeversicherung in Sachsen */
  bundesland: Bundesland;
  /** Laufendes Entgelt dieses Monats in Cent; ohne Angabe das Monatsgehalt */
  entgelt?: Cents;
}

/**
 * Ein Bestandteil des Entgelts mit den Angaben nach § 1 Abs. 2 Nr. 1 EBV: ob er sich auf den steuerpflichtigen
 * Arbeitslohn, das Sozialversicherungsbrutto und das Gesamtbrutto auswirkt und ob er laufend oder einmalig ist
 */
export interface Bestandteil {
  bezeichnung: string;
  betrag: Cents;
  laufend: boolean;
  steuerpflichtig: boolean;
  /** Pauschal besteuert nach § 40a Abs. 2 EStG (Minijob) */
  pauschalBesteuert: boolean;
  svPflichtig: boolean;
  gesamtbrutto: boolean;
}

export interface Lohnabrechnung {
  stufe: "A" | "B" | "C";
  /** Stufe C: bis zur Gegenprobe mit einem Lohnprogramm oder der Steuerberatung nur als Entwurf zu verstehen */
  gegenpruefen: boolean;
  bestandteile: Bestandteil[];
  /** Gesamtbruttoentgelt (§ 1 Abs. 2 Nr. 2 Buchst. c EBV) */
  brutto: Cents;
  /** Steuerpflichtiger laufender Arbeitslohn (RE4 im PAP) */
  steuerBrutto: Cents;
  /** Sozialversicherungsbruttoentgelt */
  svBrutto: Cents;
  /** Pauschal besteuerte Bezüge nach § 40a Abs. 2 EStG */
  pauschalBrutto: Cents;
  lohnsteuer: Cents;
  soli: Cents;
  kirchensteuer: Cents;
  sv: SvBeitraege;
  /** Gesamtbrutto abzüglich Steuern und Anteile des Beschäftigten zur Sozialversicherung (§ 1 Abs. 2 Nr. 4 EBV) */
  netto: Cents;
  /** Netto zuzüglich Zuschuss zur privaten Kranken- und Pflegeversicherung (§ 1 Abs. 2 Nr. 5 und 7 EBV) */
  auszahlung: Cents;
  /** Steuer- und Sozialversicherungstage im Abrechnungszeitraum (§ 1 Abs. 1 Nr. 6 EBV) */
  steuertage: number;
  svTage: number;
  /** Hinweise, die die Rechnung nicht verhindern */
  hinweise: string[];
}

export type LohnabrechnungErgebnis =
  | ({ ok: true } & Lohnabrechnung)
  | { ok: false; grund: "nicht-hinterlegt" | "nicht-unterstuetzt" | "ungueltig"; meldung: string };
