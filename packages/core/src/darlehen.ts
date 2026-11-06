import { formatEuro, type Cents } from "./money.ts";
import { ACCOUNTS, side, type Kontenrahmen, type PostingLine } from "./posting.ts";

/*
 * Darlehen, die das Unternehmen aufgenommen hat: Auszahlung und Tilgung sind erfolgsneutral (Bank an Darlehen bzw.
 * Darlehen an Bank), Zinsen und Gebühren Aufwand. Eine Rate wird im Bankabgleich auf Tilgung, Zins und Gebühr aufgeteilt.
 *
 * Konten aus dem DATEV-Kontenrahmen 2026 (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175): Verbindlichkeiten gegenüber
 * Kreditinstituten (SKR03 0630, SKR04 3150) bzw. Darlehen unter den sonstigen Verbindlichkeiten (1705 bzw. 3560), je mit
 * Unterkonten nach Restlaufzeit; Zinsaufwand für kurz- bzw. langfristige Verbindlichkeiten (2110/2120 bzw. 7310/7320) oder
 * zur Finanzierung des Anlagevermögens (2126 bzw. 7326), Kreditprovisionen und Verwaltungskostenbeiträge (2141 bzw. 7355).
 * Eine Grenze für die Restlaufzeit erfindet Haben nicht: Sie wird beim Anlegen gewählt, ohne Angabe bestätigt sie der
 * Jahresabschluss einer GmbH je Konto (§ 268 Abs. 5 HGB, bilanzvermerke.ts).
 */

export const DARLEHENSGEBER = {
  bank: "Kreditinstitut",
  sonstige: "Anderer Darlehensgeber (nicht Gesellschafter)",
} as const;

export type Darlehensgeber = keyof typeof DARLEHENSGEBER;

export const DARLEHENSGEBER_KEYS = Object.keys(DARLEHENSGEBER) as [Darlehensgeber, ...Darlehensgeber[]];

/** Restlaufzeit, wie sie das Konto nennt; „ohne“ = Hauptkonto, die Restlaufzeit steht dann im Abschluss */
export const DARLEHEN_LAUFZEITEN = {
  ohne: "ohne Angabe (im Jahresabschluss bestätigen)",
  bis1: "Restlaufzeit bis 1 Jahr",
  bis5: "Restlaufzeit 1 bis 5 Jahre",
  ueber5: "Restlaufzeit größer 5 Jahre",
} as const;

export type DarlehenLaufzeit = keyof typeof DARLEHEN_LAUFZEITEN;

export const DARLEHEN_LAUFZEIT_KEYS = Object.keys(DARLEHEN_LAUFZEITEN) as [DarlehenLaufzeit, ...DarlehenLaufzeit[]];

/**
 * Wofür das Geld verwendet wird: Das bestimmt Zinskonto und Zeile der Anlage EÜR (Schuldzinsen zur Finanzierung von
 * Anlagevermögen bzw. übrige Schuldzinsen); § 4 Abs. 4a EStG behandelt beide verschieden.
 */
export const DARLEHEN_ZWECKE = {
  betrieb: "Laufender Betrieb",
  anlagevermoegen: "Finanzierung von Anlagevermögen",
} as const;

export type DarlehenZweck = keyof typeof DARLEHEN_ZWECKE;

export const DARLEHEN_ZWECK_KEYS = Object.keys(DARLEHEN_ZWECKE) as [DarlehenZweck, ...DarlehenZweck[]];

/** Teil eines Bankumsatzes zu einem Darlehen */
export const DARLEHEN_TEILE = {
  auszahlung: "Auszahlung (Kreditaufnahme)",
  tilgung: "Tilgung",
  zins: "Zinsen",
  gebuehr: "Gebühren (Bearbeitung, Bereitstellung)",
} as const;

export type DarlehenTeil = keyof typeof DARLEHEN_TEILE;

export const DARLEHEN_TEIL_KEYS = Object.keys(DARLEHEN_TEILE) as [DarlehenTeil, ...DarlehenTeil[]];

const KONTEN = {
  SKR03: {
    bank: { ohne: "0630", bis1: "0631", bis5: "0640", ueber5: "0650" },
    sonstige: { ohne: "1705", bis1: "1706", bis5: "1707", ueber5: "1708" },
    zinsenKurzfristig: "2110",
    zinsenLangfristig: "2120",
    zinsenAnlagevermoegen: "2126",
    gebuehren: "2141",
  },
  SKR04: {
    bank: { ohne: "3150", bis1: "3151", bis5: "3160", ueber5: "3170" },
    sonstige: { ohne: "3560", bis1: "3561", bis5: "3564", ueber5: "3567" },
    zinsenKurzfristig: "7310",
    zinsenLangfristig: "7320",
    zinsenAnlagevermoegen: "7326",
    gebuehren: "7355",
  },
} as const;

export const DARLEHEN_KONTEN = KONTEN;

/** Bezeichnungen wie im DATEV-Kontenrahmen 2026 */
export const DARLEHEN_KONTO_NAMEN: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: {
    "0630": "Verbindlichkeiten gegenüber Kreditinstituten",
    "0631": "Verbindlichkeiten gegenüber Kreditinstituten, Restlaufzeit bis 1 Jahr",
    "0640": "Verbindlichkeiten gegenüber Kreditinstituten, Restlaufzeit 1 bis 5 Jahre",
    "0650": "Verbindlichkeiten gegenüber Kreditinstituten, Restlaufzeit größer 5 Jahre",
    "1705": "Darlehen",
    "1706": "Darlehen, Restlaufzeit bis 1 Jahr",
    "1707": "Darlehen, Restlaufzeit 1 bis 5 Jahre",
    "1708": "Darlehen, Restlaufzeit größer 5 Jahre",
    "2110": "Zinsaufwendungen für kurzfristige Verbindlichkeiten",
    "2120": "Zinsaufwendungen für langfristige Verbindlichkeiten",
    "2126": "Zinsen zur Finanzierung des Anlagevermögens",
    "2141": "Kreditprovisionen und Verwaltungskostenbeiträge",
  },
  SKR04: {
    "3150": "Verbindlichkeiten gegenüber Kreditinstituten",
    "3151": "Verbindlichkeiten gegenüber Kreditinstituten, Restlaufzeit bis 1 Jahr",
    "3160": "Verbindlichkeiten gegenüber Kreditinstituten, Restlaufzeit 1 bis 5 Jahre",
    "3170": "Verbindlichkeiten gegenüber Kreditinstituten, Restlaufzeit größer 5 Jahre",
    "3560": "Darlehen",
    "3561": "Darlehen, Restlaufzeit bis 1 Jahr",
    "3564": "Darlehen, Restlaufzeit 1 bis 5 Jahre",
    "3567": "Darlehen, Restlaufzeit größer 5 Jahre",
    "7310": "Zinsaufwendungen für kurzfristige Verbindlichkeiten",
    "7320": "Zinsaufwendungen für langfristige Verbindlichkeiten",
    "7326": "Zinsen zur Finanzierung des Anlagevermögens",
    "7355": "Kreditprovisionen und Verwaltungskostenbeiträge",
  },
};

export interface Darlehen {
  geber: Darlehensgeber;
  laufzeit: DarlehenLaufzeit;
  zweck: DarlehenZweck;
}

/** Konto der Verbindlichkeit nach Darlehensgeber und Restlaufzeit */
export function darlehenKonto(darlehen: Pick<Darlehen, "geber" | "laufzeit">, kontenrahmen: Kontenrahmen): string {
  return KONTEN[kontenrahmen][darlehen.geber][darlehen.laufzeit];
}

/**
 * Zinskonto: zur Finanzierung von Anlagevermögen das eigene Konto, sonst nach Restlaufzeit; ohne Angabe gilt ein Darlehen
 * als langfristig, kurzfristig nur mit gewählter Restlaufzeit bis zu einem Jahr
 */
export function darlehenZinskonto(darlehen: Darlehen, kontenrahmen: Kontenrahmen): string {
  const k = KONTEN[kontenrahmen];
  if (darlehen.zweck === "anlagevermoegen") return k.zinsenAnlagevermoegen;
  return darlehen.laufzeit === "bis1" ? k.zinsenKurzfristig : k.zinsenLangfristig;
}

/** Fehler als Wert: Richtung und Höhe eines Teils passen nicht zum Darlehen */
export function darlehenTeilFehler(teil: DarlehenTeil, amount: Cents, bestand: Cents): string | null {
  if (amount === 0) return "Der Teil braucht einen Betrag.";
  if (teil === "auszahlung" && amount < 0) return "Eine Auszahlung des Darlehens ist ein Eingang auf dem Konto.";
  if (teil === "tilgung") {
    if (amount > 0) return "Eine Tilgung ist ein Ausgang; eine Auszahlung des Darlehens buchst du als Auszahlung.";
    if (-amount > bestand) return `Die Tilgung ist höher als der Bestand des Darlehens (${formatEuro(bestand)}).`;
  }
  return null;
}

/**
 * Die Restschuld eines übernommenen Darlehens gilt zum Stichtag nach Tagesabschluss: Auszahlungen und Tilgungen bis
 * einschließlich dieses Tages stecken schon darin und würden den Bestand ein zweites Mal ändern (#325). Zinsen und
 * Gebühren ändern den Bestand nicht und bleiben zuordenbar.
 */
export function darlehenStichtagFehler(teil: DarlehenTeil, zahlungstag: string, stichtag: string | null): string | null {
  if (!stichtag || (teil !== "auszahlung" && teil !== "tilgung") || zahlungstag > stichtag) return null;
  const tag = (iso: string) => iso.split("-").reverse().join(".");
  return `Die Restschuld des Darlehens zum ${tag(stichtag)} enthält schon alle Auszahlungen und Tilgungen bis zu diesem Tag; ein Umsatz vom ${tag(zahlungstag)} lässt sich nicht als ${teil === "tilgung" ? "Tilgung" : "Auszahlung"} zuordnen.`;
}

/** Buchung eines Teils, amount wie auf dem Konto (Ausgang negativ) */
export function darlehenPosting(darlehen: Darlehen, teil: DarlehenTeil, amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const gegen =
    teil === "auszahlung" || teil === "tilgung"
      ? darlehenKonto(darlehen, kontenrahmen)
      : teil === "zins"
        ? darlehenZinskonto(darlehen, kontenrahmen)
        : KONTEN[kontenrahmen].gebuehren;
  return [side(ACCOUNTS[kontenrahmen].bank, amount, true, null), side(gegen, amount, false, null)].filter((l) => l.debit !== 0 || l.credit !== 0);
}

/** Text für Buchung und Liste, z. B. „Darlehen Hausbank · Tilgung“ */
export function darlehenText(name: string, teil: DarlehenTeil): string {
  return `Darlehen ${name} · ${DARLEHEN_TEILE[teil]}`;
}

/**
 * Wirkung in der EÜR: Auszahlung und Tilgung keine (erfolgsneutral), Zinsen und Gebühren als Schuldzinsen, getrennt nach
 * Finanzierung von Anlagevermögen (Zeile 55) und übrigen (Zeile 56). Geldbeschaffungskosten gehören zu den Schuldzinsen.
 */
export function darlehenEuerZeile(zweck: DarlehenZweck, teil: DarlehenTeil): "schuldzinsenAnlage" | "schuldzinsen" | null {
  if (teil === "auszahlung" || teil === "tilgung") return null;
  return zweck === "anlagevermoegen" ? "schuldzinsenAnlage" : "schuldzinsen";
}
