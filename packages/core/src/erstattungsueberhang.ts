import type { Arbeitslohn } from "./arbeitnehmer.ts";
import type { Cents } from "./money.ts";

/*
 * Erstattungsüberhang nach § 10 Abs. 4b EStG: Übersteigen Erstattungen und steuerfreie Arbeitgeberzuschüsse die
 * Aufwendungen nach Abs. 1 Nr. 3 (Basiskranken- und Pflegeversicherung) und Nr. 4 (Kirchensteuer), wird der
 * verbleibende Betrag nach Satz 3 dem Gesamtbetrag der Einkünfte hinzugerechnet; der Abzug fällt dabei nicht unter
 * null. Gerechnet wird je Person, damit der Überhang einer Person nicht die Beiträge der anderen mindert.
 */

/** Summe; fehlende Beträge zählen als null */
export const summe = (...values: (Cents | undefined)[]) => values.reduce<number>((acc, v) => acc + (v ?? 0), 0);

/** Betrag einer Bescheinigungsart über alle Bescheinigungen einer Person */
export const bescheinigt = (an: Arbeitslohn | undefined, pick: (b: Arbeitslohn["bescheinigungen"][number]) => Cents | undefined): Cents =>
  an ? summe(...an.bescheinigungen.map(pick)) : 0;

/**
 * Beiträge einer Person zur Basiskranken- und Pflegeversicherung und was ihr dafür erstattet oder zugeschossen wird.
 * PrognoseVorsorge in income-tax.ts erweitert das um Altersvorsorge, Rürup und Wahlleistungen.
 */
export interface Basisvorsorge {
  gkv?: Cents;
  gpv?: Cents;
  pkv?: Cents;
  ppv?: Cents;
  /** Erstattung der privaten Krankenversicherung für die Basisabsicherung */
  pkvErstattung?: Cents;
  /** Steuerfreier Arbeitgeberzuschuss zur gesetzlichen Krankenversicherung; mindert den abzugsfähigen Betrag */
  agZuschussGkv?: Cents;
  /** Steuerfreier Arbeitgeberzuschuss zur privaten Krankenversicherung; mindert den abzugsfähigen Betrag */
  agZuschussKv?: Cents;
  /** Steuerfreier Arbeitgeberzuschuss zur Pflegeversicherung (Nr. 24 c); mindert den abzugsfähigen Betrag */
  agZuschussPv?: Cents;
}

/**
 * Basisbeiträge einer Person: Kranken- und Pflegeversicherung ohne den Anteil für Krankengeld (4 %), abzüglich
 * Erstattung und steuerfreier Arbeitgeberzuschüsse. Ein negativer Betrag ist der Überhang dieser Person.
 */
export function basisBeitrag({ v, an }: { v: Basisvorsorge; an?: Arbeitslohn }): Cents {
  const kvArbeitnehmer = bescheinigt(an, (b) => b.kvArbeitnehmer);
  const beitraege = summe(
    v.gkv,
    v.gpv,
    v.pkv,
    v.ppv,
    Math.floor(kvArbeitnehmer * 0.96),
    bescheinigt(an, (b) => b.pvArbeitnehmer),
  );
  return beitraege - summe(v.pkvErstattung, v.agZuschussGkv, v.agZuschussKv, v.agZuschussPv);
}

/** Überhang der Basisbeiträge, je Person gekappt: was eine Person zu viel erstattet bekam, bleibt bei ihr */
export const vorsorgeUeberhang = (basis: Cents[]): Cents => summe(...basis.map((b) => Math.max(0, -b)));

/** Überhang der Kirchensteuer (Nr. 4): eine Angabe für die Veranlagung, nicht je Person */
export const kistUeberhang = (gezahlt: Cents | undefined, erstattet: Cents | undefined): Cents => Math.max(0, (erstattet ?? 0) - (gezahlt ?? 0));

/** Gesamtbetrag der Einkünfte: Gewinn und Arbeitslohn zuzüglich der Überhänge, nie negativ */
export const gesamtbetragEinkuenfte = (gewinn: Cents, einkuenfteArbeit: Cents, ...ueberhaenge: Cents[]): Cents =>
  Math.max(0, gewinn + einkuenfteArbeit + summe(...ueberhaenge));
