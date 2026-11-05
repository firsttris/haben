import { fehlendeJahre } from "../jahressperre.ts";
import type { Cents } from "../money.ts";
import { type PapAusgabe, type PapEingabe, type PapJahr, papLaufenderArbeitslohn } from "./pap.ts";
import { PAP_2026 } from "./pap-2026.ts";

export { kirchensteuerSatzBasispunkte, lohnkirchensteuer } from "./kirchensteuer.ts";
export type { PapAusgabe, PapEingabe } from "./pap.ts";

/**
 * Lohnsteuer für einen Lohnzahlungszeitraum nach dem Programmablaufplan (PAP) des BMF, mit Jahressperre.
 *
 * Für ein Jahr ohne hinterlegten PAP rechnet Haben nicht, auch nicht mit den Werten des Vorjahres: Der PAP
 * ändert sich jedes Jahr (Grundfreibetrag, Tarif, Beitragsbemessungsgrenzen), und eine Lohnabrechnung mit
 * falschen Werten haftet beim Arbeitgeber (§ 42d EStG).
 */
const PAP_JAHRE: Readonly<Record<number, PapJahr>> = { 2026: PAP_2026 };

/** Jahre, für die ein PAP hinterlegt ist */
export const LOHNSTEUER_JAHRE: readonly number[] = Object.keys(PAP_JAHRE).map(Number);

/** Herkunft des hinterlegten PAP (Datei, Version, Stand, SHA-256 des XML); scripts/jahreswerte vergleicht damit */
export const lohnsteuerPapQuelle = (jahr: number): PapJahr["quelle"] | null => PAP_JAHRE[jahr]?.quelle ?? null;

/**
 * Eingaben, die Haben noch nicht rechnet. Der PAP kennt sie; sie brauchen aber weitere Angaben (voraussichtlicher
 * Jahresarbeitslohn, Versorgungsbeginn, Geburtsjahr), und Haben hat dafür noch keine Prüffälle des BMF. Ist
 * eines davon gesetzt und nicht null, gibt `lohnsteuer` „nicht unterstützt“ zurück.
 */
export interface NichtUnterstuetzteEingabe {
  /** Sonstige Bezüge (Einmalzahlungen, Abfindungen, Vergütungen für mehrere Jahre) in Cent */
  SONSTB?: Cents;
  /** Nicht zu besteuernde Vorteile bei Vermögensbeteiligungen in Cent */
  MBV?: Cents;
  /** In RE4 enthaltene Versorgungsbezüge in Cent */
  VBEZ?: Cents;
  /** 1, wenn der Altersentlastungsbetrag zu berücksichtigen ist (64. Lebensjahr vollendet) */
  ALTER1?: 0 | 1;
  /** Freibetrag aus den ELStAM für den Lohnzahlungszeitraum in Cent */
  LZZFREIB?: Cents;
  /** Hinzurechnungsbetrag aus den ELStAM für den Lohnzahlungszeitraum in Cent */
  LZZHINZU?: Cents;
  /** Faktor im Faktorverfahren (Steuerklasse IV) in Tausendsteln; 1000 heißt ohne Faktor */
  f?: number;
}

const NICHT_UNTERSTUETZT: Record<keyof NichtUnterstuetzteEingabe, string> = {
  SONSTB: "sonstige Bezüge",
  MBV: "Vermögensbeteiligungen",
  VBEZ: "Versorgungsbezüge",
  ALTER1: "Altersentlastungsbetrag",
  LZZFREIB: "Freibetrag aus den ELStAM",
  LZZHINZU: "Hinzurechnungsbetrag aus den ELStAM",
  f: "Faktorverfahren",
};

/** Eingabe wie im PAP; fehlende Merker gelten wie dort als 0 */
export type LohnsteuerEingabe = Pick<PapEingabe, "LZZ" | "RE4" | "STKL"> & Partial<Omit<PapEingabe, "LZZ" | "RE4" | "STKL">> & NichtUnterstuetzteEingabe;

export type LohnsteuerErgebnis = ({ ok: true } & PapAusgabe) | { ok: false; grund: "nicht-hinterlegt" | "nicht-unterstuetzt" | "ungueltig"; meldung: string };

const fehler = (grund: Extract<LohnsteuerErgebnis, { ok: false }>["grund"], meldung: string): LohnsteuerErgebnis => ({ ok: false, grund, meldung });

const ganzNichtNegativ = (n: number) => Number.isSafeInteger(n) && n >= 0;
const imBereich = (n: number, bis: number) => ganzNichtNegativ(n) && n <= bis;

/** Prüft die Eingaben auf ihren Wertebereich im PAP; gibt die erste Beanstandung zurück */
function pruefe(e: PapEingabe): string | null {
  const pruefungen: [boolean, string][] = [
    [[1, 2, 3, 4].includes(e.LZZ), "LZZ muss 1 (Jahr), 2 (Monat), 3 (Woche) oder 4 (Tag) sein"],
    [[1, 2, 3, 4, 5, 6].includes(e.STKL), "STKL muss eine Steuerklasse von 1 bis 6 sein"],
    [ganzNichtNegativ(e.RE4), "RE4 muss ein ganzer, nicht negativer Betrag in Cent sein"],
    // Eine Dezimalstelle wie im PAP, also Vielfache von 100 Tausendsteln
    [ganzNichtNegativ(e.ZKF) && e.ZKF % 100 === 0, "ZKF muss in Tausendsteln mit höchstens einer Dezimalstelle angegeben sein (1,5 = 1500)"],
    [imBereich(e.KRV, 1) && imBereich(e.ALV, 1) && imBereich(e.PKV, 1), "KRV, ALV und PKV müssen 0 oder 1 sein"],
    [imBereich(e.PVS, 1) && imBereich(e.PVZ, 1) && imBereich(e.PVA, 4), "PVS und PVZ müssen 0 oder 1, PVA 0 bis 4 sein"],
    [ganzNichtNegativ(e.KVZ), "KVZ muss ein ganzer, nicht negativer Satz in Basispunkten sein"],
    [ganzNichtNegativ(e.PKPV) && ganzNichtNegativ(e.PKPVAGZ), "PKPV und PKPVAGZ müssen ganze, nicht negative Beträge in Cent sein"],
    [ganzNichtNegativ(e.R), "R muss 0 (keine Religionsgemeinschaft) oder eine positive Zahl sein"],
  ];
  return pruefungen.find(([gilt]) => !gilt)?.[1] ?? null;
}

/** Wertebereich der nicht unterstützten Eingaben: Ein falscher Wert ist ungültig, nicht „nicht unterstützt“ */
function pruefeNichtUnterstuetzte(e: NichtUnterstuetzteEingabe): string | null {
  const cent = [e.SONSTB, e.MBV, e.VBEZ, e.LZZFREIB, e.LZZHINZU].every((n) => n === undefined || ganzNichtNegativ(n));
  const pruefungen: [boolean, string][] = [
    [cent, "SONSTB, MBV, VBEZ, LZZFREIB und LZZHINZU müssen ganze, nicht negative Beträge in Cent sein"],
    [e.ALTER1 === undefined || imBereich(e.ALTER1, 1), "ALTER1 muss 0 oder 1 sein"],
    [e.f === undefined || (ganzNichtNegativ(e.f) && e.f > 0), "f muss ein positiver Faktor in Tausendsteln sein"],
  ];
  return pruefungen.find(([gilt]) => !gilt)?.[1] ?? null;
}

function nichtUnterstuetzt(e: NichtUnterstuetzteEingabe): string | null {
  const gesetzt = (Object.keys(NICHT_UNTERSTUETZT) as (keyof NichtUnterstuetzteEingabe)[]).filter((name) => {
    const wert = e[name];
    return wert !== undefined && (name === "f" ? wert !== 1000 : wert !== 0);
  });
  return gesetzt.length === 0 ? null : gesetzt.map((name) => `${NICHT_UNTERSTUETZT[name]} (${name})`).join(", ");
}

/**
 * Lohnsteuer (LSTLZZ), Solidaritätszuschlag (SOLZLZZ) und Bemessungsgrundlage der Kirchensteuer (BK) für einen
 * laufenden Lohnzahlungszeitraum des Jahres, alles in Cent. Fehler kommen als Wert zurück: ein Jahr ohne PAP,
 * ein Fall, den Haben noch nicht rechnet, oder eine Eingabe außerhalb des Wertebereichs.
 */
export function lohnsteuer(jahr: number, eingabe: LohnsteuerEingabe): LohnsteuerErgebnis {
  const pap = PAP_JAHRE[jahr];
  if (!pap) return fehler("nicht-hinterlegt", `Lohnsteuer ${jahr} ist noch nicht hinterlegt.`);
  const e: PapEingabe = {
    LZZ: eingabe.LZZ,
    RE4: eingabe.RE4,
    STKL: eingabe.STKL,
    ZKF: eingabe.ZKF ?? 0,
    KRV: eingabe.KRV ?? 0,
    ALV: eingabe.ALV ?? 0,
    KVZ: eingabe.KVZ ?? 0,
    PKV: eingabe.PKV ?? 0,
    PKPV: eingabe.PKPV ?? 0,
    PKPVAGZ: eingabe.PKPVAGZ ?? 0,
    PVS: eingabe.PVS ?? 0,
    PVZ: eingabe.PVZ ?? 0,
    PVA: eingabe.PVA ?? 0,
    R: eingabe.R ?? 0,
  };
  const ungueltig = pruefe(e) ?? pruefeNichtUnterstuetzte(eingabe);
  if (ungueltig) return fehler("ungueltig", `${ungueltig}.`);
  const offen = nichtUnterstuetzt(eingabe);
  if (offen) return fehler("nicht-unterstuetzt", `Lohnsteuer mit ${offen} ist nicht unterstützt.`);
  return { ok: true, ...papLaufenderArbeitslohn(e, pap) };
}

/** Jahre, deren PAP am Tag `heute` fehlt: das laufende Jahr und ab Dezember auch das folgende (siehe `fehlendeJahre`) */
export function fehlendeLohnsteuerJahre(heute: Date): number[] {
  return fehlendeJahre(heute, LOHNSTEUER_JAHRE);
}
