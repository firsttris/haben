import type { Beschaeftigungsart } from "./lohnabrechnung/index.ts";
import type { Cents } from "./money.ts";
import type { Kontenrahmen, PostingLine } from "./posting.ts";
import { isKapitalgesellschaft, type Rechtsform } from "./rechtsform.ts";

/*
 * Buchung einer festgeschriebenen Lohnabrechnung (docs/lohn-plan.md, PR 4): Aufwand brutto und Aufwand des Arbeitgebers
 * an die Verbindlichkeiten gegenüber Beschäftigtem, Finanzamt und Einzugsstelle. Bezahlt werden sie im Bankabgleich
 * (Zuordnungen „Lohn/Gehalt“, „Lohnsteuer an das Finanzamt“, „SV-Beiträge“, posting.ts).
 *
 * Konten aus dem DATEV-Kontenrahmen 2026, am Original geprüft (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175):
 * - SKR03 4120 / SKR04 6020 „Gehälter“, 4124 / 6024 „Geschäftsführergehälter der GmbH-Gesellschafter“,
 *   4130 / 6110 „Gesetzliche soziale Aufwendungen“;
 * - Minijob: 4195 / 6035 „Löhne für Minijobs“, 4194 / 6036 „Pauschale Steuer für Minijobber“, 4144 / 6171 „Soziale
 *   Abgaben für Minijobber“. Der Plan nannte 4190 / 6030 „Aushilfslöhne“ und 4199 / 6040 „Pauschale Steuer für
 *   Aushilfen“; der Kontenrahmen 2026 hat für Minijobs eigene Konten, und die E-Bilanz fragt sie getrennt ab
 *   (Mussfeld „Löhne und Gehälter für Minijobs“);
 * - SKR03 1740 / SKR04 3720 „Verbindlichkeiten aus Lohn und Gehalt“, 1741 / 3730 „Verbindlichkeiten aus Lohn- und
 *   Kirchensteuer“, 1742 / 3740 „Verbindlichkeiten im Rahmen der sozialen Sicherheit“. Achtung: SKR03 3730 ist
 *   „Erhaltene Skonti“ (ACCOUNTS.skontiErhalten), nur SKR04 3730 ist die Lohnsteuer.
 *
 * Die einheitliche Pauschsteuer im Minijob zieht die Deutsche Rentenversicherung Knappschaft-Bahn-See mit den Beiträgen ein
 * (§ 40a Abs. 6 Satz 1 EStG, https://www.gesetze-im-internet.de/estg/__40a.html); sie steht deshalb mit den Beiträgen auf
 * dem Konto der sozialen Sicherheit, nicht bei der Lohnsteuer.
 */

export const LOHN_KONTEN = {
  SKR03: {
    gehaelter: "4120",
    ggf: "4124",
    minijob: "4195",
    minijobPauschsteuer: "4194",
    sozial: "4130",
    minijobSozial: "4144",
    verbLohn: "1740",
    verbLohnsteuer: "1741",
    verbSv: "1742",
  },
  SKR04: {
    gehaelter: "6020",
    ggf: "6024",
    minijob: "6035",
    minijobPauschsteuer: "6036",
    sozial: "6110",
    minijobSozial: "6171",
    verbLohn: "3720",
    verbLohnsteuer: "3730",
    verbSv: "3740",
  },
} as const satisfies Record<Kontenrahmen, Record<string, string>>;

export const LOHN_KONTO_NAMEN: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: {
    "4120": "Gehälter",
    "4124": "Geschäftsführergehälter der GmbH-Gesellschafter",
    "4130": "Gesetzliche soziale Aufwendungen",
    "4144": "Soziale Abgaben für Minijobber",
    "4194": "Pauschale Steuer für Minijobber",
    "4195": "Löhne für Minijobs",
    "1740": "Verbindlichkeiten aus Lohn und Gehalt",
    "1741": "Verbindlichkeiten aus Lohn- und Kirchensteuer",
    "1742": "Verbindlichkeiten im Rahmen der sozialen Sicherheit",
  },
  SKR04: {
    "6020": "Gehälter",
    "6024": "Geschäftsführergehälter der GmbH-Gesellschafter",
    "6110": "Gesetzliche soziale Aufwendungen",
    "6171": "Soziale Abgaben für Minijobber",
    "6036": "Pauschale Steuer für Minijobber",
    "6035": "Löhne für Minijobs",
    "3720": "Verbindlichkeiten aus Lohn und Gehalt",
    "3730": "Verbindlichkeiten aus Lohn- und Kirchensteuer",
    "3740": "Verbindlichkeiten im Rahmen der sozialen Sicherheit",
  },
};

/** Was die Buchung von einer Abrechnung braucht (Spalten von `payslips`) */
export interface LohnBuchungsAbrechnung {
  art: Beschaeftigungsart;
  brutto: Cents;
  lohnsteuer: Cents;
  soli: Cents;
  kirchensteuer: Cents;
  /** Anteile des Beschäftigten zur Sozialversicherung */
  svArbeitnehmer: Cents;
  /** Aufwand des Arbeitgebers über den Lohn hinaus: Anteile, Umlagen und Pauschsteuer */
  svArbeitgeber: Cents;
  /** Pauschsteuer im Minijob, in `svArbeitgeber` enthalten */
  pauschsteuer: Cents;
  netto: Cents;
  auszahlung: Cents;
}

export type LohnBuchungErgebnis = { ok: true; lines: PostingLine[] } | { ok: false; meldung: string };

const soll = (account: string, amount: Cents): PostingLine => ({ account, debit: amount, credit: 0, taxCode: null });
const haben = (account: string, amount: Cents): PostingLine => ({ account, debit: 0, credit: amount, taxCode: null });
const betrag = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** Was sich an der Abrechnung nicht buchen lässt; null = buchbar */
function nichtBuchbar(a: LohnBuchungsAbrechnung, rechtsform: Rechtsform): string | null {
  const werte = [a.brutto, a.lohnsteuer, a.soli, a.kirchensteuer, a.svArbeitnehmer, a.svArbeitgeber, a.pauschsteuer, a.netto, a.auszahlung];
  if (!werte.every(betrag)) return "Die Abrechnung enthält ungültige Beträge.";
  if (a.brutto - a.lohnsteuer - a.soli - a.kirchensteuer - a.svArbeitnehmer !== a.netto)
    return "Brutto, Abzüge und Netto der Abrechnung passen nicht zusammen.";
  if (a.pauschsteuer > a.svArbeitgeber || (a.pauschsteuer > 0 && a.art !== "minijob")) return "Eine Pauschsteuer gibt es nur im Minijob.";
  if (a.art === "ggf" && !isKapitalgesellschaft(rechtsform)) {
    return "Einen Gesellschafter-Geschäftsführer gibt es nur in GmbH und UG; im Einzelunternehmen ist der Lohn des Inhabers eine Entnahme.";
  }
  // Ein Zuschuss zur privaten Kranken- und Pflegeversicherung gehört auf ein eigenes Konto; rechnen kann Haben ihn noch nicht
  if (a.auszahlung !== a.netto) return "Eine Auszahlung über das Netto hinaus (Zuschuss zur Krankenversicherung) ist in der Buchung nicht unterstützt.";
  return null;
}

/**
 * Buchungssatz einer Abrechnung: Aufwand an Verbindlichkeiten, ohne Steuerschlüssel (Lohn ist keine Leistung im Sinne des
 * UStG). Zeilen mit 0 € entfallen.
 */
export function lohnBuchung(a: LohnBuchungsAbrechnung, kontenrahmen: Kontenrahmen, rechtsform: Rechtsform): LohnBuchungErgebnis {
  const fehler = nichtBuchbar(a, rechtsform);
  if (fehler) return { ok: false, meldung: fehler };
  const k = LOHN_KONTEN[kontenrahmen];
  const minijob = a.art === "minijob";
  const aufwand = a.art === "ggf" ? k.ggf : minijob ? k.minijob : k.gehaelter;
  const lines = [
    soll(aufwand, a.brutto),
    soll(minijob ? k.minijobSozial : k.sozial, a.svArbeitgeber - a.pauschsteuer),
    soll(k.minijobPauschsteuer, a.pauschsteuer),
    haben(k.verbLohn, a.auszahlung),
    haben(k.verbLohnsteuer, a.lohnsteuer + a.soli + a.kirchensteuer),
    haben(k.verbSv, a.svArbeitnehmer + a.svArbeitgeber),
  ];
  return { ok: true, lines: lines.filter((l) => l.debit !== 0 || l.credit !== 0) };
}

/** Gegenbuchung beim Storno einer Abrechnung: dieselben Zeilen, Soll und Haben getauscht */
export function lohnStornoBuchung(lines: readonly PostingLine[]): PostingLine[] {
  return lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit, taxCode: l.taxCode }));
}
