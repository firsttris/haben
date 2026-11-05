import type { BasisPoints, Cents } from "../money.ts";

/** Beitragsanteile von Beschäftigtem (`an`) und Arbeitgeber (`ag`) in Cent */
export interface Anteile {
  an: Cents;
  ag: Cents;
}

export const KEINE: Anteile = { an: 0, ag: 0 };

/** Merkmale für den Beitrag zur Pflegeversicherung */
export interface Pflegemerkmale {
  /** Beitragszuschlag für Kinderlose: ohne Elterneigenschaft und mindestens 23 Jahre alt (§ 55 Abs. 3 SGB XI) */
  kinderlosenzuschlag: boolean;
  /** Zahl der Kinder unter 25; ab dem zweiten mindert jedes den Anteil des Beschäftigten, höchstens vier Abschläge */
  kinderUnter25: number;
}

/** Krankenversicherung des Beschäftigten: gesetzlich mit dem Zusatzbeitrag der Kasse, oder privat (KV und PV 0) */
export type Krankenversicherung = { art: "gesetzlich"; zusatzbeitrag: BasisPoints } | { art: "privat" };

/** Umlagesätze der Krankenkasse; `u1` ist null, wenn der Arbeitgeber nicht am U1-Verfahren teilnimmt (mehr als 30 Beschäftigte) */
export interface UmlageSaetze {
  u1: BasisPoints | null;
  u2: BasisPoints;
}

/**
 * Fälle, die Haben nicht rechnet. Sie brauchen Angaben über diesen Monat hinaus (andere Arbeitgeber,
 * Jahresentgelt, Beschäftigungsdauer) oder eigene Regeln, für die Haben keine belegten Beispielrechnungen hat.
 */
export interface NichtUnterstuetzteMerkmale {
  /** Weitere Beschäftigung bei einem anderen Arbeitgeber: Entgelte werden zusammengerechnet, auch im Übergangsbereich */
  mehrfachbeschaeftigung?: boolean;
  /** Kurzfristige Beschäftigung (§ 8 Abs. 1 Nr. 2 SGB IV), auch Saisonarbeit: keine Beiträge, aber eigene Umlageregeln */
  kurzfristig?: boolean;
  /** Auszubildende: kein Übergangsbereich, bis 325 € trägt der Arbeitgeber allein (§ 20 Abs. 3 SGB IV) */
  auszubildend?: boolean;
  /** Minijob im Privathaushalt: andere Pauschalen, Haushaltsscheckverfahren */
  privathaushalt?: boolean;
  /** Einmalig gezahltes Arbeitsentgelt in Cent: anteilige Jahres-BBG, Märzklausel */
  einmalzahlung?: Cents;
  /** Sozialversicherungstage im Monat; ein Teilmonat mindert die BBG anteilig. 30 ist der volle Monat */
  svTage?: number;
}

interface Gemeinsam extends NichtUnterstuetzteMerkmale {
  /** Laufendes Arbeitsentgelt des Monats in Cent */
  entgelt: Cents;
}

/** Sozialversicherungspflichtig beschäftigt; zwischen Geringfügigkeitsgrenze und 2.000 € im Übergangsbereich (Midijob) */
export interface Beschaeftigt extends Gemeinsam {
  personengruppe: "beschaeftigt";
  kv: Krankenversicherung;
  pflege: Pflegemerkmale;
  /** Beschäftigungsort in Sachsen: anderer Anteil an der Pflegeversicherung (§ 58 Abs. 3 SGB XI) */
  sachsen: boolean;
  umlagen: UmlageSaetze;
  /**
   * Regelmäßiges Monatsentgelt der Beschäftigung, etwa das vereinbarte Monatsgehalt aus der Lohnabrechnung. Ob der
   * Übergangsbereich gilt, hängt am regelmäßigen Entgelt („Arbeitsentgelte …, die regelmäßig 2 000 Euro im Monat nicht
   * übersteigen“, § 20 Abs. 2 SGB IV); liegt dieser Monat in einem anderen Bereich, rechnet Haben nicht (siehe `index.ts`)
   */
  regelmaessigesEntgelt?: Cents;
}

/** Geringfügig entlohnte Beschäftigung im gewerblichen Bereich (Personengruppe 109) */
export interface Minijob extends Gemeinsam {
  personengruppe: "minijob";
  /** Gesetzlich krankenversichert (auch familienversichert): Pauschalbeitrag zur KV */
  gesetzlichKrankenversichert: boolean;
  /** Von der Rentenversicherungspflicht befreit (§ 6 Abs. 1b SGB VI): kein Anteil des Beschäftigten */
  rvBefreit: boolean;
  /** Einheitliche Pauschsteuer statt Lohnsteuer nach ELStAM */
  pauschsteuer: boolean;
  /** Arbeitgeber nimmt am U1-Verfahren teil */
  u1: boolean;
}

/**
 * Gesellschafter-Geschäftsführer ohne Sozialversicherungspflicht (mindestens 50 % des Kapitals oder echte
 * Sperrminorität). Keine Beiträge und keine Umlagen: U1 gilt für GmbH-Geschäftsführer nie, U2 und Insolvenzgeldumlage
 * nur für Beschäftigte im Sinne des § 7 Abs. 1 SGB IV.
 */
export interface GesellschafterGeschaeftsfuehrer extends Gemeinsam {
  personengruppe: "ggf";
}

export type SvEingabe = Beschaeftigt | Minijob | GesellschafterGeschaeftsfuehrer;

/** Beiträge eines Monats; Summen ohne die Unfallversicherung (Berufsgenossenschaft, jährlich nach Umlage) */
export interface SvBeitraege {
  personengruppe: SvEingabe["personengruppe"];
  /** Bemessungsgrundlagen in Cent; `arbeitnehmer` nur im Übergangsbereich (beitragspflichtige Einnahme für den AN-Anteil) */
  bemessung: { kvPv: Cents; rvAv: Cents; arbeitnehmer: Cents | null };
  /** KV zum allgemeinen Satz; im Minijob die Pauschale */
  kv: Anteile;
  /**
   * Kassenindividueller Zusatzbeitrag, getrennt gerechnet und gerundet wie im Beitragsnachweis; so auch das
   * Beispiel 7 im TK-Beratungsblatt zum Übergangsbereich (03/2026)
   */
  kvZusatz: Anteile;
  pv: Anteile;
  rv: Anteile;
  av: Anteile;
  /** Umlagen trägt der Arbeitgeber allein */
  umlagen: { u1: Cents; u2: Cents; insolvenzgeld: Cents };
  /** Pauschale Lohnsteuer im Minijob, trägt hier der Arbeitgeber */
  pauschsteuer: Cents;
  /** Abzug vom Lohn: Summe der Anteile des Beschäftigten */
  arbeitnehmer: Cents;
  /** Aufwand des Arbeitgebers über den Lohn hinaus: seine Anteile, Umlagen und Pauschsteuer */
  arbeitgeber: Cents;
}

export type SvErgebnis = ({ ok: true } & SvBeitraege) | { ok: false; grund: "nicht-hinterlegt" | "nicht-unterstuetzt" | "ungueltig"; meldung: string };

/** Summen aus den Einzelbeträgen */
export function mitSummen(b: Omit<SvBeitraege, "arbeitnehmer" | "arbeitgeber">): SvBeitraege {
  const zweige = [b.kv, b.kvZusatz, b.pv, b.rv, b.av];
  const arbeitnehmer = zweige.reduce((s, z) => s + z.an, 0);
  const arbeitgeber = zweige.reduce((s, z) => s + z.ag, 0) + b.umlagen.u1 + b.umlagen.u2 + b.umlagen.insolvenzgeld + b.pauschsteuer;
  return { ...b, arbeitnehmer, arbeitgeber };
}
