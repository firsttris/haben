import type { BasisPoints, Cents } from "../money.ts";
import {
  alsGanzzahl,
  type Dezimal,
  dez,
  ganzzahl,
  geteilt,
  geteiltExakt,
  groesser,
  groesster,
  kleiner,
  kleinster,
  mal,
  minus,
  NULL,
  plus,
  runden,
} from "./dezimal.ts";

/**
 * Lohnsteuer, Solidaritätszuschlag und Bemessungsgrundlage der Kirchensteuer für einen laufenden
 * Lohnzahlungszeitraum nach dem Programmablaufplan (PAP) des BMF für die maschinelle Berechnung der Lohnsteuer.
 *
 * Von Hand aus dem amtlichen PAP-XML übertragen (Herkunft und Version in `pap-2026.ts`), Methode für Methode;
 * jede Funktion nennt die Methode und die Seite im PAP. Die Namen der Felder sind die des PAP. Der PAP rechnet
 * mit veränderlichen Feldern einer Java-Klasse; hier gibt jede Methode ihre Ergebnisse zurück.
 *
 * Übertragen ist nur der laufende Arbeitslohn ohne Versorgungsbezüge, Altersentlastungsbetrag, Freibetrag,
 * Hinzurechnungsbetrag und Faktorverfahren. Mit diesen Eingaben sind im PAP FVB, FVBZ, ALTE, JLFREIB und JLHINZU
 * null und f = 1; `lohnsteuer` in `index.ts` lehnt die übrigen Fälle ab, bevor sie hier ankommen. Sonstige
 * Bezüge (MSONST) fehlen ganz: Ohne SONSTB und MBV ändert MSONST an LSTLZZ, SOLZLZZ und BK nichts.
 */

/** Werte eines Jahres, die im PAP als Zahlen in den Methoden stehen */
export interface PapJahr {
  jahr: number;
  quelle: { datei: string; version: string; stand: string; sha256: string };
  BBGRVALV: Dezimal;
  AVSATZAN: Dezimal;
  RVSATZAN: Dezimal;
  BBGKVPV: Dezimal;
  /** Allgemeiner Beitragssatz der Krankenversicherung, Anteil des Arbeitnehmers (MPARA) */
  kvSatzAnOhneZusatz: Dezimal;
  pvSatzAn: Dezimal;
  pvSatzAnSachsen: Dezimal;
  pvZuschlagKinderlos: Dezimal;
  pvAbschlagJeKind: Dezimal;
  W1STKL5: Dezimal;
  W2STKL5: Dezimal;
  W3STKL5: Dezimal;
  GFB: Dezimal;
  SOLZFREI: Dezimal;
  arbeitnehmerPauschbetrag: Dezimal;
  SAP: Dezimal;
  EFA: Dezimal;
  /** Freibeträge für Kinder je Zähler in den Steuerklassen I bis III */
  kinderfreibetrag: Dezimal;
  /** … und in Steuerklasse IV */
  kinderfreibetragHalb: Dezimal;
  hoechstbetragVorsorge: Dezimal;
  zone2Bis: Dezimal;
  zone2: [Dezimal, Dezimal];
  zone3Bis: Dezimal;
  zone3Ab: Dezimal;
  zone3: [Dezimal, Dezimal, Dezimal];
  zone4Bis: Dezimal;
  zone4: [Dezimal, Dezimal];
  zone5: [Dezimal, Dezimal];
  stkl5Satz42: Dezimal;
  stkl5Satz45: Dezimal;
  stkl5Oben: Dezimal;
  stkl5Unten: Dezimal;
  stkl5Mindest: Dezimal;
  solzSatz: Dezimal;
  solzMilderung: Dezimal;
}

/** Eingaben des PAP, die hier gerechnet werden; geprüft in `index.ts` */
export interface PapEingabe {
  /** Lohnzahlungszeitraum: 1 = Jahr, 2 = Monat, 3 = Woche, 4 = Tag */
  LZZ: 1 | 2 | 3 | 4;
  /** Steuerpflichtiger Arbeitslohn für den Lohnzahlungszeitraum in Cent */
  RE4: Cents;
  /** Steuerklasse 1 bis 6 */
  STKL: 1 | 2 | 3 | 4 | 5 | 6;
  /** Zahl der Freibeträge für Kinder in Tausendsteln (im PAP mit einer Dezimalstelle: 1,5 = 1500) */
  ZKF: number;
  /** 1, wenn der Arbeitnehmer nicht in der gesetzlichen Rentenversicherung pflichtversichert ist */
  KRV: 0 | 1;
  /** 1, wenn der Arbeitnehmer nicht in der Arbeitslosenversicherung pflichtversichert ist */
  ALV: 0 | 1;
  /** Kassenindividueller Zusatzbeitragssatz in Basispunkten (im PAP Prozent: 2,50 % = 250) */
  KVZ: BasisPoints;
  /** 1, wenn der Arbeitnehmer ausschließlich privat krankenversichert ist */
  PKV: 0 | 1;
  /** Beiträge zur privaten Basiskranken- und Pflege-Pflichtversicherung, Monatsbetrag in Cent */
  PKPV: Cents;
  /** Arbeitgeberzuschuss dazu, Monatsbetrag in Cent */
  PKPVAGZ: Cents;
  /** 1, wenn die Besonderheiten der Pflegeversicherung in Sachsen gelten */
  PVS: 0 | 1;
  /** 1, wenn der Arbeitnehmer den Zuschlag für Kinderlose zur Pflegeversicherung zahlt */
  PVZ: 0 | 1;
  /** Zahl der Beitragsabschläge in der Pflegeversicherung für das 2. bis 5. Kind (0 bis 4) */
  PVA: 0 | 1 | 2 | 3 | 4;
  /** Religionsgemeinschaft; größer 0 heißt kirchensteuerpflichtig */
  R: number;
}

/** Ausgaben des PAP in Cent */
export interface PapAusgabe {
  /** Für den Lohnzahlungszeitraum einzubehaltende Lohnsteuer */
  LSTLZZ: Cents;
  /** Für den Lohnzahlungszeitraum einzubehaltender Solidaritätszuschlag */
  SOLZLZZ: Cents;
  /** Bemessungsgrundlage für die Kirchenlohnsteuer */
  BK: Cents;
}

const ZAHL1 = dez("1");
const ZAHL2 = dez("2");
const ZAHL7 = dez("7");
const ZAHL12 = dez("12");
const ZAHL100 = dez("100");
const ZAHL360 = dez("360");
const ZAHL700 = dez("700");
const ZAHL10000 = dez("10000");

/** MPARA (PAP Seite 14): Beitragssätze des Arbeitnehmers zur Kranken- und Pflegeversicherung */
function mpara(e: PapEingabe, p: PapJahr): { KVSATZAN: Dezimal; PVSATZAN: Dezimal } {
  const kvz = ganzzahl(e.KVZ, 2); // Basispunkte → Prozent mit zwei Dezimalstellen wie im PAP
  const KVSATZAN = plus(geteiltExakt(geteiltExakt(kvz, ZAHL2), ZAHL100), p.kvSatzAnOhneZusatz);
  const pv = e.PVS === 1 ? p.pvSatzAnSachsen : p.pvSatzAn;
  const PVSATZAN = e.PVZ === 1 ? plus(pv, p.pvZuschlagKinderlos) : minus(pv, mal(ganzzahl(e.PVA), p.pvAbschlagJeKind));
  return { KVSATZAN, PVSATZAN };
}

/** MRE4JL (PAP Seite 15): Arbeitslohn auf ein Jahr hochgerechnet, in Euro mit zwei Nachkommastellen */
function mre4jl(e: PapEingabe): Dezimal {
  const RE4 = ganzzahl(e.RE4);
  if (e.LZZ === 1) return geteilt(RE4, ZAHL100, 2, "ab");
  if (e.LZZ === 2) return geteilt(mal(RE4, ZAHL12), ZAHL100, 2, "ab");
  if (e.LZZ === 3) return geteilt(mal(RE4, ZAHL360), ZAHL700, 2, "ab");
  return geteilt(mal(RE4, ZAHL360), ZAHL100, 2, "ab");
}

/** UPANTEIL (PAP Seite 32): Anteil eines Jahresbetrags in Cent für den Lohnzahlungszeitraum */
function upanteil(JW: Dezimal, LZZ: PapEingabe["LZZ"]): Dezimal {
  if (LZZ === 1) return JW;
  if (LZZ === 2) return geteilt(JW, ZAHL12, 0, "ab");
  if (LZZ === 3) return geteilt(mal(JW, ZAHL7), ZAHL360, 0, "ab");
  return geteilt(JW, ZAHL360, 0, "ab");
}

interface Tabellenfreibetraege {
  ZTABFB: Dezimal;
  KZTAB: 1 | 2;
  KFB: Dezimal;
}

/** MZTABFB (PAP Seite 22): feste Tabellenfreibeträge ohne Vorsorgepauschale; ohne Versorgungsbezüge ist ZVBEZ = 0 */
function mztabfb(e: PapEingabe, ZRE4: Dezimal, p: PapJahr): Tabellenfreibetraege {
  const ANP = e.STKL < 6 && groesser(ZRE4, NULL) ? kleinster(runden(ZRE4, 0, "auf"), p.arbeitnehmerPauschbetrag) : NULL;
  const SAP = e.STKL < 6 ? p.SAP : NULL;
  const EFA = e.STKL === 2 ? p.EFA : NULL;
  const ZKF = ganzzahl(e.ZKF, 3);
  const KFB = e.STKL <= 3 ? mal(ZKF, p.kinderfreibetrag) : e.STKL === 4 ? mal(ZKF, p.kinderfreibetragHalb) : NULL;
  return {
    ZTABFB: runden(plus(plus(EFA, ANP), SAP), 2, "ab"),
    KZTAB: e.STKL === 3 ? 2 : 1,
    KFB: runden(KFB, 0, "ab"),
  };
}

/** UPEVP mit MVSPKVPV und MVSPHB (PAP Seiten 26 bis 28): Vorsorgepauschale in Euro; ZRE4VP ist ZRE4J */
function upevp(e: PapEingabe, ZRE4VP: Dezimal, p: PapJahr): Dezimal {
  const { KVSATZAN, PVSATZAN } = mpara(e, p);
  const bisRvGrenze = kleinster(ZRE4VP, p.BBGRVALV);
  const VSPR = e.KRV === 1 ? NULL : runden(mal(bisRvGrenze, p.RVSATZAN), 2, "ab");

  const VSPKVPV =
    e.PKV > 0
      ? e.STKL === 6
        ? NULL
        : groesster(
            minus(
              runden(geteiltExakt(mal(ganzzahl(e.PKPV), ZAHL12), ZAHL100), 2, "ab"),
              runden(geteiltExakt(mal(ganzzahl(e.PKPVAGZ), ZAHL12), ZAHL100), 2, "ab"),
            ),
            NULL,
          )
      : runden(mal(kleinster(ZRE4VP, p.BBGKVPV), plus(KVSATZAN, PVSATZAN)), 2, "ab");
  const VSP = runden(plus(VSPKVPV, VSPR), 0, "auf");
  if (e.ALV === 1 || e.STKL === 6) return VSP;

  // MVSPHB: Höchstbetrag für Arbeitslosen-, Kranken- und Pflegeversicherung
  const VSPALV = runden(mal(p.AVSATZAN, bisRvGrenze), 2, "ab");
  const VSPHB = kleinster(runden(plus(VSPALV, VSPKVPV), 2, "ab"), p.hoechstbetragVorsorge);
  const VSPN = runden(plus(VSPR, VSPHB), 0, "auf");
  return groesster(VSP, VSPN);
}

/** UPTAB26 (PAP Seite 38): tarifliche Einkommensteuer nach § 32a EStG in Euro, mal KZTAB */
export function uptab(X: Dezimal, KZTAB: 1 | 2, p: PapJahr): Dezimal {
  const zone = (): Dezimal => {
    if (kleiner(X, plus(p.GFB, ZAHL1))) return NULL;
    if (kleiner(X, p.zone2Bis)) {
      const Y = geteilt(minus(X, p.GFB), ZAHL10000, 6, "ab");
      const RW = plus(mal(Y, p.zone2[0]), p.zone2[1]);
      return runden(mal(RW, Y), 0, "ab");
    }
    if (kleiner(X, p.zone3Bis)) {
      const Y = geteilt(minus(X, p.zone3Ab), ZAHL10000, 6, "ab");
      const RW = mal(plus(mal(Y, p.zone3[0]), p.zone3[1]), Y);
      return runden(plus(RW, p.zone3[2]), 0, "ab");
    }
    const [satz, abzug] = kleiner(X, p.zone4Bis) ? p.zone4 : p.zone5;
    return runden(minus(mal(X, satz), abzug), 0, "ab");
  };
  return mal(zone(), ganzzahl(KZTAB));
}

/** UP5_6 (PAP Seite 30): Steuer auf ZX in den Steuerklassen V und VI */
function up5_6(ZX: Dezimal, p: PapJahr): Dezimal {
  const ST1 = uptab(runden(mal(ZX, p.stkl5Oben), 0, "ab"), 1, p);
  const ST2 = uptab(runden(mal(ZX, p.stkl5Unten), 0, "ab"), 1, p);
  const DIFF = mal(minus(ST1, ST2), ZAHL2);
  const MIST = runden(mal(ZX, p.stkl5Mindest), 0, "ab");
  return groesser(MIST, DIFF) ? MIST : DIFF;
}

/** MST5_6 (PAP Seite 29): Lohnsteuer für die Steuerklassen V und VI (§ 39b Abs. 2 Satz 7 EStG) */
function mst5_6(ZZX: Dezimal, p: PapJahr): Dezimal {
  const zuschlag = (ST: Dezimal, von: Dezimal, bis: Dezimal, satz: Dezimal) => runden(plus(ST, mal(minus(bis, von), satz)), 0, "ab");
  if (groesser(ZZX, p.W2STKL5)) {
    const ST = up5_6(p.W2STKL5, p);
    if (!groesser(ZZX, p.W3STKL5)) return zuschlag(ST, p.W2STKL5, ZZX, p.stkl5Satz42);
    return zuschlag(zuschlag(ST, p.W2STKL5, p.W3STKL5, p.stkl5Satz42), p.W3STKL5, ZZX, p.stkl5Satz45);
  }
  const VERGL = up5_6(ZZX, p);
  if (!groesser(ZZX, p.W1STKL5)) return VERGL;
  const HOCH = zuschlag(up5_6(p.W1STKL5, p), p.W1STKL5, ZZX, p.stkl5Satz42);
  return kleiner(HOCH, VERGL) ? HOCH : VERGL;
}

/** MLSTJAHR mit UPMLST (PAP Seiten 23 und 25): Jahressteuer in Euro auf ZRE4 nach Abzug von ZTABFB und VSP */
function mlstjahr(e: PapEingabe, ZRE4: Dezimal, ZTABFB: Dezimal, KZTAB: 1 | 2, VSP: Dezimal, p: PapJahr): Dezimal {
  const ZVE = minus(minus(ZRE4, ZTABFB), VSP);
  const X = kleiner(ZVE, ZAHL1) ? NULL : runden(geteiltExakt(ZVE, ganzzahl(KZTAB)), 0, "ab");
  return e.STKL < 5 ? uptab(X, KZTAB, p) : mst5_6(X, p);
}

/** MSOLZ (PAP Seite 31): Solidaritätszuschlag und Bemessungsgrundlage der Kirchensteuer für den Zeitraum */
function msolz(e: PapEingabe, JBMG: Dezimal, KZTAB: 1 | 2, p: PapJahr): { SOLZLZZ: Dezimal; BK: Dezimal } {
  const SOLZFREI = mal(p.SOLZFREI, ganzzahl(KZTAB));
  const solz = (): Dezimal => {
    if (!groesser(JBMG, SOLZFREI)) return NULL;
    const SOLZJ = runden(geteiltExakt(mal(JBMG, p.solzSatz), ZAHL100), 2, "ab");
    const SOLZMIN = runden(geteiltExakt(mal(minus(JBMG, SOLZFREI), p.solzMilderung), ZAHL100), 2, "ab");
    return upanteil(runden(mal(kleinster(SOLZJ, SOLZMIN), ZAHL100), 0, "ab"), e.LZZ);
  };
  return { SOLZLZZ: solz(), BK: e.R > 0 ? upanteil(mal(JBMG, ZAHL100), e.LZZ) : NULL };
}

/**
 * MAIN mit MRE4JL, MRE4ABZ und MBERECH (PAP Seiten 13, 15, 20 und 21). Die Lohnsteuer rechnet ohne,
 * Solidaritätszuschlag und Kirchensteuer mit den Freibeträgen für Kinder (§ 51a Abs. 2a EStG).
 */
export function papLaufenderArbeitslohn(e: PapEingabe, p: PapJahr): PapAusgabe {
  const ZRE4J = mre4jl(e);
  const ZRE4 = groesster(runden(ZRE4J, 2, "ab"), NULL);
  const { ZTABFB, KZTAB, KFB } = mztabfb(e, ZRE4, p);
  const VSP = upevp(e, ZRE4J, p);

  const LSTJAHR = runden(mlstjahr(e, ZRE4, ZTABFB, KZTAB, VSP, p), 0, "ab");
  const LSTLZZ = upanteil(mal(LSTJAHR, ZAHL100), e.LZZ);
  const JBMG = e.ZKF > 0 ? runden(mlstjahr(e, ZRE4, plus(ZTABFB, KFB), KZTAB, VSP, p), 0, "ab") : LSTJAHR;
  const { SOLZLZZ, BK } = msolz(e, JBMG, KZTAB, p);
  return { LSTLZZ: alsGanzzahl(LSTLZZ), SOLZLZZ: alsGanzzahl(SOLZLZZ), BK: alsGanzzahl(BK) };
}
