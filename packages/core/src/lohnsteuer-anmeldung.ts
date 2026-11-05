import { naechsterWerktag } from "./holidays.ts";
import type { Konfession } from "./lohnabrechnung/typen.ts";
import type { Cents } from "./money.ts";
import { MONTHS } from "./period.ts";
import type { Bundesland } from "./steuernummer.ts";

/*
 * Lohnsteuer-Anmeldung (§ 41a EStG): Anmeldungszeitraum, Frist und Kennzahlen aus den festgeschriebenen Lohnabrechnungen.
 * Kennzahlen, Zeitraum-Schlüssel und Regeln aus Schema und Jahresdokumentation LStA_2026 und LStA_2027 im ERiC-Paket
 * 45.1.5.0 (Datenarten/ElsterAnmeldung/LStA); das XML baut packages/elster/src/lsta.ts.
 *
 * - Zuordnung zum Anmeldungszeitraum nach dem Zahltag: angemeldet wird die im Zeitraum einbehaltene Lohnsteuer
 *   (§ 41a Abs. 1 Satz 1 EStG), einbehalten wird bei jeder Lohnzahlung (§ 38 Abs. 3 Satz 1 EStG).
 * - Getrennt nach dem Kalenderjahr, in dem der Arbeitslohn als bezogen gilt (§ 41a Abs. 1 Satz 1 Nr. 1 EStG): laufender
 *   Arbeitslohn im Jahr, in dem der Lohnzahlungszeitraum endet (§ 38a Abs. 1 Satz 2 EStG). Der Dezember mit Zahltag im
 *   Januar steht deshalb in der Spalte „Vorjahr“ der Januar-Anmeldung.
 * - Die Pauschsteuer von 2 % im Minijob (§ 40a Abs. 2 EStG) gehört nicht in die Lohnsteuer-Anmeldung: Sie geht mit den
 *   Beiträgen an die Minijob-Zentrale (§ 40a Abs. 6 EStG). Der Minijobber zählt aber bei der Zahl der Arbeitnehmer
 *   (Kz 86): laut Vordruck einschließlich der an die Deutsche Rentenversicherung Knappschaft-Bahn-See gemeldeten
 *   geringfügig Beschäftigten (Muster der Lohnsteuer-Anmeldung 2026, BMF-Schreiben vom 14. August 2025).
 */

export type LstaTurnus = "monatlich" | "vierteljaehrlich" | "jaehrlich";

export const LSTA_TURNUS_LABEL: Record<LstaTurnus, string> = {
  monatlich: "monatlich",
  vierteljaehrlich: "vierteljährlich",
  jaehrlich: "jährlich",
};

/** Zeitraum-Schlüssel des Schemas: 01–12 Monate, 41–44 Kalendervierteljahre, 19 Kalenderjahr */
export const LSTA_KALENDERJAHR = 19;

export interface LstaZeitraum {
  year: number;
  /** 1–12, 41–44 oder 19 */
  zeitraum: number;
}

export function isLstaZeitraum(z: LstaZeitraum): boolean {
  return Number.isInteger(z.year) && ((z.zeitraum >= 1 && z.zeitraum <= 12) || (z.zeitraum >= 41 && z.zeitraum <= 44) || z.zeitraum === LSTA_KALENDERJAHR);
}

/** Wie das Schema den Zeitraum schreibt: "01", "41", "19" */
export const lstaZeitraumCode = (z: LstaZeitraum) => String(z.zeitraum).padStart(2, "0");

/** "2026-10", "2026-Q4", "2026" */
export function lstaKey({ year, zeitraum }: LstaZeitraum): string {
  if (zeitraum === LSTA_KALENDERJAHR) return String(year);
  return zeitraum >= 41 ? `${year}-Q${zeitraum - 40}` : `${year}-${String(zeitraum).padStart(2, "0")}`;
}

export function parseLstaKey(key: string): LstaZeitraum | null {
  const match = /^(\d{4})(?:-(?:(\d{2})|Q([1-4])))?$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const zeitraum = match[3] ? 40 + Number(match[3]) : match[2] ? Number(match[2]) : LSTA_KALENDERJAHR;
  // "2026-19" ist kein Monat; das Kalenderjahr heißt "2026"
  if (match[2] && zeitraum > 12) return null;
  const z = { year, zeitraum };
  return isLstaZeitraum(z) && year >= 2000 && year <= 2100 ? z : null;
}

/** "Oktober 2026", "4. Quartal 2026", "Kalenderjahr 2026" */
export function lstaLabel({ year, zeitraum }: LstaZeitraum): string {
  if (zeitraum === LSTA_KALENDERJAHR) return `Kalenderjahr ${year}`;
  return zeitraum >= 41 ? `${zeitraum - 40}. Quartal ${year}` : `${MONTHS[zeitraum - 1]} ${year}`;
}

/** Erster und letzter Monat des Zeitraums (1–12) */
function monate({ zeitraum }: LstaZeitraum): { von: number; bis: number } {
  if (zeitraum === LSTA_KALENDERJAHR) return { von: 1, bis: 12 };
  if (zeitraum >= 41) return { von: (zeitraum - 41) * 3 + 1, bis: (zeitraum - 40) * 3 };
  return { von: zeitraum, bis: zeitraum };
}

/** Erster Tag des Zeitraums und erster Tag danach (ausschließlich), JJJJ-MM-TT */
export function lstaBereich(z: LstaZeitraum): { start: string; end: string } {
  const { von, bis } = monate(z);
  const start = `${z.year}-${String(von).padStart(2, "0")}-01`;
  const end = bis === 12 ? `${z.year + 1}-01-01` : `${z.year}-${String(bis + 1).padStart(2, "0")}-01`;
  return { start, end };
}

/** Der Zeitraum, in den ein Tag (JJJJ-MM-TT) fällt */
export function lstaZeitraumAm(datum: string, turnus: LstaTurnus): LstaZeitraum {
  const year = Number(datum.slice(0, 4));
  const month = Number(datum.slice(5, 7));
  if (turnus === "jaehrlich") return { year, zeitraum: LSTA_KALENDERJAHR };
  return { year, zeitraum: turnus === "vierteljaehrlich" ? 40 + Math.ceil(month / 3) : month };
}

/**
 * Abgabe und Zahlung spätestens am zehnten Tag nach Ablauf des Zeitraums (§ 41a Abs. 1 Satz 1 EStG); fällt der auf ein
 * Wochenende oder einen Feiertag, am nächsten Werktag (§ 108 Abs. 3 AO).
 */
export function lstaFrist(z: LstaZeitraum, bundesland: Bundesland | null): string {
  const { end } = lstaBereich(z);
  return naechsterWerktag(`${end.slice(0, 8)}10`, bundesland);
}

// ------------------------------------------------------------------ Anmeldungszeitraum (§ 41a Abs. 2 EStG)

/** Grenzen aus § 41a Abs. 2 Satz 2 EStG: Kalenderjahr bis 1.080 €, Vierteljahr bis 5.000 €, darüber Monat */
export const LSTA_JAEHRLICH_BIS: Cents = 1_080_00;
export const LSTA_VIERTELJAEHRLICH_BIS: Cents = 5_000_00;

export function turnusFuerJahresbetrag(lohnsteuer: Cents): LstaTurnus {
  if (lohnsteuer <= LSTA_JAEHRLICH_BIS) return "jaehrlich";
  return lohnsteuer <= LSTA_VIERTELJAEHRLICH_BIS ? "vierteljaehrlich" : "monatlich";
}

export interface LstaTurnusBasis {
  year: number;
  /**
   * Abzuführende Lohnsteuer des Vorjahres und die Zahl der Monate, in denen die Betriebsstätte darin bestand (1–12);
   * null, wenn sie im Vorjahr noch nicht bestand oder Haben das Vorjahr nicht kennt
   */
  vorjahr: { lohnsteuer: Cents; monate: number } | null;
  /** Hat die Betriebsstätte im Vorjahr noch nicht bestanden: Lohnsteuer des ersten vollen Kalendermonats nach der Eröffnung */
  ersterVollerMonat: { lohnsteuer: Cents; monat: string } | null;
}

export interface LstaTurnusVorschlag {
  turnus: LstaTurnus;
  /** Jahresbetrag, aus dem der Zeitraum folgt */
  jahresbetrag: Cents;
  grund: string;
}

const euro = (cents: Cents) => `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)} €`;

const GRUND_TURNUS: Record<LstaTurnus, string> = {
  jaehrlich: "höchstens 1.080 €: jährlich",
  vierteljaehrlich: "mehr als 1.080 €, höchstens 5.000 €: vierteljährlich",
  monatlich: "mehr als 5.000 €: monatlich",
};

/**
 * Anmeldungszeitraum nach § 41a Abs. 2 EStG aus der Lohnsteuer des Vorjahres; bestand die Betriebsstätte nicht das
 * ganze Vorjahr, auf einen Jahresbetrag umgerechnet (Satz 3), im ersten Jahr aus dem ersten vollen Kalendermonat nach
 * der Eröffnung, auf das Jahr hochgerechnet (Satz 4). Abgerundet auf ganze Cent: Ein Bruchteil eines Cents hebt einen
 * Betrag nicht über eine Grenze in vollen Euro. null, wenn Haben keine Grundlage hat.
 */
export function lstaTurnusVorschlag(basis: LstaTurnusBasis): LstaTurnusVorschlag | null {
  if (basis.vorjahr) {
    const { lohnsteuer, monate } = basis.vorjahr;
    if (!Number.isInteger(monate) || monate < 1 || monate > 12) throw new RangeError(`Monate im Vorjahr: ${monate}`);
    const jahresbetrag = Math.floor((lohnsteuer * 12) / monate);
    const turnus = turnusFuerJahresbetrag(jahresbetrag);
    const umgerechnet = monate < 12 ? `, aus ${monate} Monaten auf das Jahr umgerechnet (§ 41a Abs. 2 Satz 3 EStG)` : "";
    return {
      turnus,
      jahresbetrag,
      grund: `Lohnsteuer ${basis.year - 1}: ${euro(jahresbetrag)}${umgerechnet}; ${GRUND_TURNUS[turnus]} (§ 41a Abs. 2 EStG).`,
    };
  }
  if (basis.ersterVollerMonat) {
    const jahresbetrag = basis.ersterVollerMonat.lohnsteuer * 12;
    const turnus = turnusFuerJahresbetrag(jahresbetrag);
    const [jahr, monat] = basis.ersterVollerMonat.monat.split("-").map(Number);
    return {
      turnus,
      jahresbetrag,
      grund: `Erstes Jahr: Lohnsteuer ${MONTHS[monat! - 1]} ${jahr} mal zwölf, ${euro(jahresbetrag)}; ${GRUND_TURNUS[turnus]} (§ 41a Abs. 2 Satz 4 EStG).`,
    };
  }
  return null;
}

/** Erster voller Kalendermonat ab einem Tag (JJJJ-MM-TT), "JJJJ-MM": derselbe, wenn der Tag der Erste ist */
export function ersterVollerMonat(eroeffnung: string): string {
  const [y, m, d] = eroeffnung.split("-").map(Number);
  if (d === 1) return eroeffnung.slice(0, 7);
  return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`;
}

/** Volle Monate, in denen die Betriebsstätte im Jahr bestand; 0, wenn sie erst im Dezember nach dem Ersten eröffnet wurde */
export function volleMonateImJahr(eroeffnung: string, year: number): number {
  if (Number(eroeffnung.slice(0, 4)) < year) return 12;
  if (Number(eroeffnung.slice(0, 4)) > year) return 0;
  const erster = ersterVollerMonat(eroeffnung);
  return Number(erster.slice(0, 4)) > year ? 0 : 13 - Number(erster.slice(5, 7));
}

// ------------------------------------------------------------------ Kennzahlen

/** Eine festgeschriebene, nicht stornierte Abrechnung, deren Zahltag im Anmeldungszeitraum liegt */
export interface LstaAbrechnung {
  /** Mitarbeiter, für die Zahl der Arbeitnehmer */
  mitarbeiter: string;
  /** Jahr des Lohnzahlungszeitraums: in diesem Jahr gilt der laufende Arbeitslohn als bezogen */
  jahr: number;
  lohnsteuer: Cents;
  soli: Cents;
  kirchensteuer: Cents;
  konfession: Konfession | null;
}

/** Ein Betrag getrennt nach dem Kalenderjahr des Bezugs, wie die Felder _Vorjahr, _lfdJahr, _Folgejahr */
export interface Jahresteile {
  vorjahr: Cents;
  lfdJahr: Cents;
  folgejahr: Cents;
}

export const summeJahresteile = (t: Jahresteile): Cents => t.vorjahr + t.lfdJahr + t.folgejahr;

/** Kirchensteuer-Kennzahlen, die Haben füllt: Kz 61 evangelisch, Kz 62 römisch-katholisch, Kz 63 alt-katholisch */
export type LstaKircheKz = "kz61" | "kz62" | "kz63";

/**
 * Kennzahl je Kirchensteuermerkmal: evangelisch, evangelisch-lutherisch und evangelisch-reformiert sind „Evangelische
 * Kirchensteuer“ (Kz 61), rk Kz 62, ak „Alt-Katholische Kirchensteuer“ (Kz 63); Bezeichnungen laut Jahresdokumentation.
 */
export const LSTA_KIRCHE_KZ: Record<Konfession, LstaKircheKz> = { ev: "kz61", lt: "kz61", rf: "kz61", rk: "kz62", ak: "kz63" };

/**
 * Länder, in denen Kz 63 nicht zulässig ist: Regeln LStA_LoKi_HB, _MV, _SN, _ST, _TH der Jahresdokumentation LStA_2026
 * (Fehler, wenn das Feld bei einer Steuernummer dieses Landes angegeben ist). Kz 61 und 62 sind überall zulässig.
 */
const OHNE_KZ63: readonly Bundesland[] = ["HB", "MV", "SN", "ST", "TH"];

export interface LstaKennzahlen {
  kz42: Jahresteile;
  kz49: Jahresteile;
  kirche: Record<LstaKircheKz, Jahresteile>;
  /** Verbleiben: Kz 41 + 42 + 44 − 33 − 45; Haben kennt nur Kz 42 */
  kz48: Cents;
  /** Gesamtbetrag: Kz 47 + 48 + 49 + Kirchensteuer */
  kz83: Cents;
  /** Zahl der Arbeitnehmer */
  kz86: number;
}

const leer = (): Jahresteile => ({ vorjahr: 0, lfdJahr: 0, folgejahr: 0 });

/** Felder _Vorjahr nur bei Zeitraum 01, 02, 41 und 19, _Folgejahr nur bei 12, 44 und 19 (Regeln LStA_Vorjahrangabe_unzulaessig, LStA_Folgejahrangabe_unzulaessig) */
const VORJAHR_ZULAESSIG = [1, 2, 41, LSTA_KALENDERJAHR];
const FOLGEJAHR_ZULAESSIG = [12, 44, LSTA_KALENDERJAHR];

export type LstaErgebnis = { ok: true; kennzahlen: LstaKennzahlen } | { ok: false; probleme: string[] };

/**
 * Kennzahlen der Anmeldung eines Zeitraums. Nicht unterstützt (statt falsch gemeldet): Arbeitslohn eines Jahres, das
 * weder Vorjahr, laufendes noch Folgejahr ist, Vorjahr oder Folgejahr in einem Zeitraum, der sie nicht zulässt, und
 * Kirchensteuer, für die das Land keine Kennzahl vorsieht.
 */
export function lstaKennzahlen(input: { zeitraum: LstaZeitraum; bundesland: Bundesland; abrechnungen: readonly LstaAbrechnung[] }): LstaErgebnis {
  const { zeitraum, bundesland } = input;
  const probleme = new Set<string>();
  const kz42 = leer();
  const kz49 = leer();
  const kirche: Record<LstaKircheKz, Jahresteile> = { kz61: leer(), kz62: leer(), kz63: leer() };
  for (const a of input.abrechnungen) {
    const teil: keyof Jahresteile | null =
      a.jahr === zeitraum.year ? "lfdJahr" : a.jahr === zeitraum.year - 1 ? "vorjahr" : a.jahr === zeitraum.year + 1 ? "folgejahr" : null;
    if (!teil) {
      probleme.add(`Nicht unterstützt: Arbeitslohn für ${a.jahr} in der Anmeldung ${lstaLabel(zeitraum)}.`);
      continue;
    }
    if (teil === "vorjahr" && !VORJAHR_ZULAESSIG.includes(zeitraum.zeitraum)) {
      probleme.add(
        `Nicht unterstützt: Arbeitslohn für ${a.jahr} mit Zahltag in ${lstaLabel(zeitraum)}; die Anmeldung nimmt Lohnsteuer des Vorjahres nur im Januar, Februar, ersten Quartal oder Kalenderjahr an.`,
      );
    }
    if (teil === "folgejahr" && !FOLGEJAHR_ZULAESSIG.includes(zeitraum.zeitraum)) {
      probleme.add(
        `Nicht unterstützt: Arbeitslohn für ${a.jahr} mit Zahltag in ${lstaLabel(zeitraum)}; die Anmeldung nimmt Lohnsteuer des Folgejahres nur im Dezember, vierten Quartal oder Kalenderjahr an.`,
      );
    }
    kz42[teil] += a.lohnsteuer;
    kz49[teil] += a.soli;
    if (a.kirchensteuer !== 0) {
      if (!a.konfession) {
        probleme.add("Kirchensteuer ohne Kirchensteuermerkmal in einer Abrechnung.");
        continue;
      }
      const kz = LSTA_KIRCHE_KZ[a.konfession];
      if (kz === "kz63" && OHNE_KZ63.includes(bundesland)) {
        probleme.add(`Nicht unterstützt: Alt-katholische Kirchensteuer (Kz 63) sieht die Lohnsteuer-Anmeldung in ${bundesland} nicht vor.`);
      }
      kirche[kz][teil] += a.kirchensteuer;
    }
  }
  if (probleme.size > 0) return { ok: false, probleme: [...probleme] };
  const kz48 = summeJahresteile(kz42);
  const kirchensteuer = Object.values(kirche).reduce((s, t) => s + summeJahresteile(t), 0);
  return {
    ok: true,
    kennzahlen: {
      kz42,
      kz49,
      kirche,
      kz48,
      kz83: kz48 + summeJahresteile(kz49) + kirchensteuer,
      kz86: new Set(input.abrechnungen.map((a) => a.mitarbeiter)).size,
    },
  };
}

/** Gleiche Kennzahlen? Für „seit der Übermittlung geändert“ */
export function lstaKennzahlenGleich(a: LstaKennzahlen, b: LstaKennzahlen): boolean {
  // Feld für Feld: jsonb in Postgres ordnet die Schlüssel um
  const teile = (x: Jahresteile, y: Jahresteile) => x.vorjahr === y.vorjahr && x.lfdJahr === y.lfdJahr && x.folgejahr === y.folgejahr;
  return (
    teile(a.kz42, b.kz42) &&
    teile(a.kz49, b.kz49) &&
    (["kz61", "kz62", "kz63"] as const).every((kz) => teile(a.kirche[kz], b.kirche[kz])) &&
    a.kz48 === b.kz48 &&
    a.kz83 === b.kz83 &&
    a.kz86 === b.kz86
  );
}
