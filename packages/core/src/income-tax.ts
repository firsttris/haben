import { altersvorsorgeQuote, arbeitslohnErgebnis, type Arbeitslohn } from "./arbeitnehmer.ts";
import type { Cents } from "./money.ts";
import type { Bundesland } from "./steuernummer.ts";

/**
 * Einkommensteuer nach § 32a EStG mit Splitting, Solidaritätszuschlag und Kirchensteuer, dazu eine
 * Prognose aus Gewinn und den Angaben zur Einkommensteuererklärung. Tarifwerte für 2024 bis 2026 wie
 * im Programmablaufplan des BMF (abgeglichen mit dem Paket lohnsteuer-bmf), 2023 laut § 32a EStG in der
 * Fassung des Inflationsausgleichsgesetzes.
 *
 * Die Prognose ist eine Schätzung für Vorauszahlungen, keine Steuerberechnung des Finanzamts.
 */

interface Tarif {
  grundfreibetrag: number;
  zone2Bis: number;
  zone2: [number, number];
  zone3Bis: number;
  zone3: [number, number, number];
  zone4Abzug: number;
  zone5Abzug: number;
  soliFreigrenze: number;
  /** Kinderfreibetrag und Freibetrag für Betreuung, Erziehung, Ausbildung beider Elternteile */
  kinderfreibetrag: number;
  /** Kindergeld je Kind und Monat */
  kindergeld: number;
  /**
   * Höchstbetrag der Altersvorsorgeaufwendungen (§ 10 Abs. 3 Satz 1 EStG): Höchstbeitrag zur knappschaftlichen
   * Rentenversicherung, also Beitragsbemessungsgrenze × 24,7 %, auf volle Euro aufgerundet (BMF-Schreiben zu
   * § 10 EStG). Bei Zusammenveranlagung doppelt.
   */
  altersvorsorgeHoechst: number;
}

const TARIFE: Record<number, Tarif> = {
  2023: {
    grundfreibetrag: 10_908,
    zone2Bis: 15_999,
    zone2: [979.18, 1400],
    zone3Bis: 62_809,
    zone3: [192.59, 2397, 966.53],
    zone4Abzug: 9972.98,
    zone5Abzug: 18_307.73,
    soliFreigrenze: 17_543,
    kinderfreibetrag: 8952,
    kindergeld: 250,
    altersvorsorgeHoechst: 26_528, // 107.400 € × 24,7 %
  },
  2024: {
    grundfreibetrag: 11_784,
    zone2Bis: 17_005,
    zone2: [954.8, 1400],
    zone3Bis: 66_760,
    zone3: [181.19, 2397, 991.21],
    zone4Abzug: 10_636.31,
    zone5Abzug: 18_971.06,
    soliFreigrenze: 18_130,
    kinderfreibetrag: 9540,
    kindergeld: 250,
    altersvorsorgeHoechst: 27_566, // 111.600 € × 24,7 %
  },
  2025: {
    grundfreibetrag: 12_096,
    zone2Bis: 17_443,
    zone2: [932.3, 1400],
    zone3Bis: 68_480,
    zone3: [176.64, 2397, 1015.13],
    zone4Abzug: 10_911.92,
    zone5Abzug: 19_246.67,
    soliFreigrenze: 19_950,
    kinderfreibetrag: 9600,
    kindergeld: 255,
    altersvorsorgeHoechst: 29_344, // 118.800 € × 24,7 %
  },
  2026: {
    grundfreibetrag: 12_348,
    zone2Bis: 17_799,
    zone2: [914.51, 1400],
    zone3Bis: 69_878,
    zone3: [173.1, 2397, 1034.87],
    zone4Abzug: 11_135.63,
    zone5Abzug: 19_470.38,
    soliFreigrenze: 20_350,
    kinderfreibetrag: 9756,
    kindergeld: 259,
    altersvorsorgeHoechst: 30_826, // 124.800 € (10.400 € im Monat) × 24,7 %
  },
};

const ZONE5_AB = 277_826;

export const EST_TARIF_JAHRE = Object.keys(TARIFE).map(Number);

/** Tarif des Jahres; für spätere Jahre der jüngste bekannte */
function tarif(year: number): Tarif {
  const known = TARIFE[year] ?? TARIFE[Math.max(...EST_TARIF_JAHRE)];
  if (!known || year < Math.min(...EST_TARIF_JAHRE)) throw new RangeError(`Kein Einkommensteuertarif für ${year}.`);
  return known;
}

/** Grundtarif in vollen Euro (§ 32a Abs. 1 EStG) */
function grundtarifEuro(zvE: number, t: Tarif): number {
  const x = Math.floor(zvE);
  if (x <= t.grundfreibetrag) return 0;
  if (x <= t.zone2Bis) {
    const y = (x - t.grundfreibetrag) / 10_000;
    return Math.floor((t.zone2[0] * y + t.zone2[1]) * y);
  }
  if (x <= t.zone3Bis) {
    const z = (x - t.zone2Bis) / 10_000;
    return Math.floor((t.zone3[0] * z + t.zone3[1]) * z + t.zone3[2]);
  }
  if (x < ZONE5_AB) return Math.floor(0.42 * x - t.zone4Abzug);
  return Math.floor(0.45 * x - t.zone5Abzug);
}

/** Tarifliche Einkommensteuer; Splitting verdoppelt die Steuer auf das halbe zvE (§ 32a Abs. 5 EStG) */
export function einkommensteuer(zvE: Cents, year: number, splitting = false): Cents {
  const t = tarif(year);
  const euro = Math.max(0, Math.floor(zvE / 100));
  const steuer = splitting ? 2 * grundtarifEuro(Math.floor(euro / 2), t) : grundtarifEuro(euro, t);
  return steuer * 100;
}

/** Solidaritätszuschlag: 5,5 %, Freigrenze und Milderungszone (11,9 % des übersteigenden Betrags) */
export function solidaritaetszuschlag(est: Cents, year: number, zusammen = false): Cents {
  const freigrenze = tarif(year).soliFreigrenze * (zusammen ? 2 : 1) * 100;
  if (est <= freigrenze) return 0;
  return Math.floor(Math.min(est * 0.055, (est - freigrenze) * 0.119));
}

/** 8 % in Baden-Württemberg und Bayern, sonst 9 % */
export function kirchensteuerSatz(bundesland: Bundesland | null): number {
  return bundesland === "BW" || bundesland === "BY" ? 0.08 : 0.09;
}

/** Religionsschlüssel, für die Kirchensteuer erhoben wird (11 = keine Religionszugehörigkeit, 10 = sonstige) */
export function kirchensteuerpflichtig(religion: string | undefined): boolean {
  return Boolean(religion) && religion !== "11" && religion !== "10";
}

export interface PrognoseVorsorge {
  rentenversicherung?: Cents;
  gkv?: Cents;
  gpv?: Cents;
  gkvZusatz?: Cents;
  pkv?: Cents;
  ppv?: Cents;
  pkvErstattung?: Cents;
}

export interface PrognoseAngaben {
  vorsorge: { a: PrognoseVorsorge; b?: PrognoseVorsorge; sonstige?: Cents };
  sonderausgaben: { kirchensteuerGezahlt?: Cents; kirchensteuerErstattet?: Cents; spenden?: Cents };
  krankheitskosten?: Cents;
  haushaltsnah: { minijobs?: Cents; dienstleistungen?: Cents; handwerker?: Cents };
  kinder: { kinderbetreuung?: Cents }[];
  /** Arbeitslohn je Person (Anlage N) */
  arbeitnehmer?: { a?: Arbeitslohn; b?: Arbeitslohn };
}

export interface PrognoseInput {
  year: number;
  /** Gewinn aus selbständiger Arbeit bzw. Gewerbebetrieb */
  gewinn: Cents;
  zusammen: boolean;
  /** Kirchensteuerpflicht der Personen A und B */
  kirche: { a: boolean; b: boolean };
  bundesland: Bundesland | null;
  angaben: PrognoseAngaben;
}

export interface Prognose {
  year: number;
  /** Einkünfte aus nichtselbständiger Arbeit nach Werbungskosten bzw. Pauschbetrag */
  einkuenfteArbeit: Cents;
  gesamtbetragEinkuenfte: Cents;
  vorsorge: Cents;
  sonderausgaben: Cents;
  kinderbetreuung: Cents;
  aussergewoehnlich: Cents;
  zvE: Cents;
  /** Kinderfreibeträge statt Kindergeld (Günstigerprüfung) */
  kinderfreibetrag: boolean;
  /** Tarifliche Einkommensteuer, ggf. mit hinzugerechnetem Kindergeld */
  tariflich: Cents;
  /** Steuerermäßigung nach § 35a EStG */
  ermaessigung35a: Cents;
  einkommensteuer: Cents;
  soli: Cents;
  kirchensteuer: Cents;
  gesamt: Cents;
  /** Einbehaltene Lohnsteuer mit Soli und Kirchensteuer, wird angerechnet */
  steuerabzug: Cents;
  /** Gesamt abzüglich Steuerabzug; negativ heißt Erstattung */
  verbleibend: Cents;
  /** Ein Viertel der verbleibenden Jahressteuer, je Vorauszahlungstermin */
  jeQuartal: Cents;
}

const sum = (...values: (Cents | undefined)[]) => values.reduce<number>((acc, v) => acc + (v ?? 0), 0);

/**
 * Abziehbare Vorsorgeaufwendungen (§ 10 Abs. 1 Nr. 2, 3, 3a und Abs. 3, 4 EStG). Altersvorsorge bis zum
 * Höchstbetrag des Jahres, davon der Arbeitgeberanteil ab. Übrige Vorsorge: Höchstbetrag 2.800 € für
 * Selbständige, 1.900 € für Arbeitnehmer (Zuschuss des Arbeitgebers zur Krankenversicherung). Beiträge
 * laut Lohnsteuerbescheinigung: Rentenversicherung mit Arbeitgeberanteil abzüglich dieses Anteils,
 * Krankenversicherung ohne den Anteil für Krankengeld (4 %).
 */
function vorsorgeAbzug(year: number, personen: { v: PrognoseVorsorge; an?: Arbeitslohn }[], sonstige: Cents | undefined): Cents {
  const lstb = (an: Arbeitslohn | undefined, pick: (b: Arbeitslohn["bescheinigungen"][number]) => Cents | undefined) =>
    an ? sum(...an.bescheinigungen.map(pick)) : 0;
  const ag = sum(...personen.map(({ an }) => lstb(an, (b) => b.rvArbeitgeber)));
  const eigen = sum(...personen.map(({ v, an }) => lstb(an, (b) => b.rvArbeitnehmer) + (v.rentenversicherung ?? 0)));
  const hoechstAlter = tarif(year).altersvorsorgeHoechst * personen.length * 100;
  const alter = Math.max(0, Math.floor(Math.min(eigen + ag, hoechstAlter) * altersvorsorgeQuote(year)) - ag);
  const basis = Math.max(
    0,
    sum(
      ...personen.map(({ v, an }) => {
        const kvAn = lstb(an, (b) => b.kvArbeitnehmer);
        return sum(v.gkv, v.gpv, v.pkv, v.ppv, Math.floor(kvAn * 0.96), lstb(an, (b) => b.pvArbeitnehmer)) - (v.pkvErstattung ?? 0);
      }),
    ),
  );
  const weitere = sum(
    sonstige,
    ...personen.map(({ v, an }) => {
      const kvAn = lstb(an, (b) => b.kvArbeitnehmer);
      return sum(v.gkvZusatz, kvAn - Math.floor(kvAn * 0.96), lstb(an, (b) => b.avArbeitnehmer));
    }),
  );
  const hoechst = sum(...personen.map(({ an }) => (an && an.bescheinigungen.length > 0 ? 1_900_00 : 2_800_00)));
  return alter + Math.max(basis, Math.min(basis + weitere, hoechst));
}

/** Zumutbare Belastung (§ 33 Abs. 3 EStG), stufenweise nach BFH */
function zumutbareBelastung(gde: Cents, zusammen: boolean, kinder: number): Cents {
  const saetze = kinder >= 3 ? [1, 1, 2] : kinder >= 1 ? [2, 3, 4] : zusammen ? [4, 5, 6] : [5, 6, 7];
  const stufen = [15_340_00, 51_130_00, Infinity];
  let rest = gde;
  let unten = 0;
  let ergebnis = 0;
  stufen.forEach((oben, i) => {
    const teil = Math.max(0, Math.min(rest, oben - unten));
    ergebnis += (teil * saetze[i]!) / 100;
    rest -= teil;
    unten = oben;
  });
  return Math.floor(ergebnis);
}

/** Schätzt Einkommensteuer, Soli und Kirchensteuer eines Jahres */
export function steuerPrognose(input: PrognoseInput): Prognose {
  const { year, zusammen, angaben: x } = input;
  const t = tarif(year);
  const arbeit = (zusammen ? [x.arbeitnehmer?.a, x.arbeitnehmer?.b] : [x.arbeitnehmer?.a])
    .filter((an): an is Arbeitslohn => Boolean(an && an.bescheinigungen.length > 0))
    .map((an) => arbeitslohnErgebnis(year, an));
  const einkuenfteArbeit = sum(...arbeit.map((a) => a.einkuenfte));
  const steuerabzug = sum(...arbeit.map((a) => a.steuerabzug));
  const gde = Math.max(0, input.gewinn + einkuenfteArbeit);
  const kinder = x.kinder.length;

  const vorsorge = vorsorgeAbzug(
    year,
    zusammen
      ? [
          { v: x.vorsorge.a, an: x.arbeitnehmer?.a },
          { v: x.vorsorge.b ?? {}, an: x.arbeitnehmer?.b },
        ]
      : [{ v: x.vorsorge.a, an: x.arbeitnehmer?.a }],
    x.vorsorge.sonstige,
  );
  const kist = Math.max(0, sum(x.sonderausgaben.kirchensteuerGezahlt) - sum(x.sonderausgaben.kirchensteuerErstattet));
  const spenden = Math.min(sum(x.sonderausgaben.spenden), Math.floor(gde * 0.2));
  const sonderausgaben = Math.max(kist + spenden, (zusammen ? 72 : 36) * 100);
  // Kinderbetreuung: bis 2024 zwei Drittel, höchstens 4.000 €; ab 2025 80 %, höchstens 4.800 € je Kind
  const kinderbetreuung = x.kinder.reduce((acc, k) => {
    const kosten = k.kinderbetreuung ?? 0;
    return acc + (year >= 2025 ? Math.min(Math.floor(kosten * 0.8), 4_800_00) : Math.min(Math.floor((kosten * 2) / 3), 4_000_00));
  }, 0);
  const aussergewoehnlich = Math.max(0, sum(x.krankheitskosten) - zumutbareBelastung(gde, zusammen, kinder));

  const einkommen = Math.max(0, gde - vorsorge - sonderausgaben - kinderbetreuung - aussergewoehnlich);

  // Günstigerprüfung Kindergeld gegen Kinderfreibeträge; ohne Zusammenveranlagung je zur Hälfte
  const anteil = zusammen ? 1 : 0.5;
  const kfb = Math.round(kinder * t.kinderfreibetrag * anteil) * 100;
  const kindergeld = Math.round(kinder * t.kindergeld * 12 * anteil) * 100;
  const ohneKfb = einkommensteuer(einkommen, year, zusammen);
  const mitKfb = einkommensteuer(Math.max(0, einkommen - kfb), year, zusammen);
  const kinderfreibetrag = kinder > 0 && ohneKfb - mitKfb > kindergeld;
  const zvE = kinderfreibetrag ? Math.max(0, einkommen - kfb) : einkommen;
  const tariflich = kinderfreibetrag ? mitKfb + kindergeld : ohneKfb;

  // § 35a: 20 %, höchstens 510 € (Minijobs), 4.000 € (Dienstleistungen), 1.200 € (Handwerker)
  const h = x.haushaltsnah;
  const ermaessigung35a = Math.min(
    tariflich,
    Math.min(Math.floor(sum(h.minijobs) * 0.2), 510_00) +
      Math.min(Math.floor(sum(h.dienstleistungen) * 0.2), 4_000_00) +
      Math.min(Math.floor(sum(h.handwerker) * 0.2), 1_200_00),
  );
  const est = tariflich - ermaessigung35a;

  // Zuschlagsteuern immer mit Kinderfreibeträgen (§ 51a Abs. 2 EStG)
  const basisZuschlag = Math.max(0, (kinder > 0 ? mitKfb : ohneKfb) - ermaessigung35a);
  const soli = solidaritaetszuschlag(basisZuschlag, year, zusammen);
  // Nur ein Ehegatte in der Kirche: vereinfacht die Hälfte (Halbteilung)
  const kirchenAnteil = zusammen ? (Number(input.kirche.a) + Number(input.kirche.b)) / 2 : Number(input.kirche.a);
  const kirchensteuer = Math.floor(basisZuschlag * kirchensteuerSatz(input.bundesland) * kirchenAnteil);

  const gesamt = est + soli + kirchensteuer;
  const verbleibend = gesamt - steuerabzug;
  return {
    year,
    einkuenfteArbeit,
    gesamtbetragEinkuenfte: gde,
    vorsorge,
    sonderausgaben,
    kinderbetreuung,
    aussergewoehnlich,
    zvE,
    kinderfreibetrag,
    tariflich,
    ermaessigung35a,
    einkommensteuer: est,
    soli,
    kirchensteuer,
    gesamt,
    steuerabzug,
    verbleibend,
    jeQuartal: Math.round(Math.max(0, verbleibend) / 4 / 100) * 100,
  };
}
