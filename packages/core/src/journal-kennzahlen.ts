import type { Cents } from "./money.ts";
import { ACCOUNTS, type Kontenrahmen, type Versteuerung } from "./posting.ts";

/*
 * Kennzahlen der Umsatzsteuer-Voranmeldung aus Konto und Steuerschlüssel der Journalzeilen (#542, Schritt 2). Heute
 * rechnet die Voranmeldung aus den Nebenbüchern (vat-figures.ts); diese Zuordnung ist die Grundlage, sie aus dem Journal
 * nachzurechnen und mit dem Nebenbuch abzugleichen. Die Felder heißen wie in VatFigures.
 *
 * Gemessen an allen Postgres-Tests (1364 Voranmeldungen): bei Soll-Versteuerung stimmen 98,5 % in allen Kennzahlen
 * überein. Was das Journal noch nicht trägt, steht in #542 unter „Messung“: die Bemessungsgrundlage an der Zahlung bei
 * Ist-Versteuerung, die Privatnutzung von Fahrzeugen im Monat der Nutzung und § 13b ohne Vorsteuerabzug bzw. mit Privatanteil.
 */

export const JOURNAL_KENNZAHLEN = [
  "kz81",
  "tax81",
  "kz86",
  "tax86",
  "kz21",
  "kz45",
  "kz48",
  "kz66",
  "kz46",
  "kz47",
  "kz84",
  "kz85",
  "kz67",
  "kz41",
  "kz43",
  "kz89",
  "tax89",
  "kz93",
  "tax93",
  "kz61",
  "kz62",
  /** Regulär besteuerte Umsätze zu 0 %: gebucht, aber in keiner Kennzahl gemeldet */
  "steuerfrei",
] as const;

export type JournalKennzahl = (typeof JOURNAL_KENNZAHLEN)[number];

export type JournalKennzahlen = Record<JournalKennzahl, Cents>;

export interface JournalZeile {
  account: string;
  debit: Cents;
  credit: Cents;
  taxCode: string | null;
}

/** Welche Seite eine Kennzahl erhöht: Umsätze und geschuldete Steuer im Haben, Vorsteuer und Bezüge im Soll */
type Seite = "haben" | "soll";

interface Ziel {
  feld: JournalKennzahl;
  seite: Seite;
}

/** Steuerschlüssel der Bemessungsgrundlage (Erlös- bzw. Aufwandszeile) → Kennzahl */
const BEMESSUNG: Record<string, Ziel> = {
  USt19: { feld: "kz81", seite: "haben" },
  USt7: { feld: "kz86", seite: "haben" },
  RC: { feld: "kz21", seite: "haben" },
  Drittland: { feld: "kz45", seite: "haben" },
  Steuerfrei: { feld: "kz48", seite: "haben" },
  IGL: { feld: "kz41", seite: "haben" },
  Ausfuhr: { feld: "kz43", seite: "haben" },
  frei: { feld: "steuerfrei", seite: "haben" },
  RC13bEU: { feld: "kz46", seite: "soll" },
  RC13bDrittland: { feld: "kz84", seite: "soll" },
  IGE19: { feld: "kz89", seite: "soll" },
  IGE7: { feld: "kz93", seite: "soll" },
  EUSt: { feld: "kz62", seite: "soll" },
};

/**
 * Die Kennzahl einer Journalzeile, oder null, wenn die Zeile in keine Kennzahl gehört (Forderungen, Bank, Aufwand mit
 * Vorsteuer, Kleinunternehmer, „Umsatzsteuer nicht fällig“, die erst mit der Umbuchung bei Zahlung zählt). Steuerkonten
 * gehen vor dem Steuerschlüssel: Die Steuer zählt nach dem Konto, auf dem sie steht.
 */
export function kennzahlDerZeile(kontenrahmen: Kontenrahmen, zeile: JournalZeile): { feld: JournalKennzahl; betrag: Cents } | null {
  const a = ACCOUNTS[kontenrahmen];
  const ziel = (feld: JournalKennzahl, seite: Seite) => ({ feld, betrag: seite === "haben" ? zeile.credit - zeile.debit : zeile.debit - zeile.credit });
  switch (zeile.account) {
    case a.ust[1900]:
      return ziel("tax81", "haben");
    case a.ust[700]:
      return ziel("tax86", "haben");
    case a.ustNichtFaellig[1900]:
    case a.ustNichtFaellig[700]:
      return null;
    case a.vorsteuer[1900]:
    case a.vorsteuer[700]:
      return ziel("kz66", "soll");
    case a.vorsteuerRc:
      return ziel("kz67", "soll");
    case a.vorsteuerIge[1900]:
    case a.vorsteuerIge[700]:
      return ziel("kz61", "soll");
    case a.ustRc:
      return ziel(zeile.taxCode === "RC13bDrittland" ? "kz85" : "kz47", "haben");
    case a.ustIge[1900]:
      return ziel("tax89", "haben");
    case a.ustIge[700]:
      return ziel("tax93", "haben");
  }
  const bemessung = zeile.taxCode === null ? undefined : BEMESSUNG[zeile.taxCode];
  return bemessung ? ziel(bemessung.feld, bemessung.seite) : null;
}

export function leereJournalKennzahlen(): JournalKennzahlen {
  return Object.fromEntries(JOURNAL_KENNZAHLEN.map((feld) => [feld, 0])) as JournalKennzahlen;
}

/**
 * Bemessungsgrundlagen, die bei Ist-Versteuerung erst mit der Zahlung gemeldet werden: steuerpflichtige und steuerfreie
 * inländische Umsätze (Kz 81, 86, 43, 48, 0 %). Reverse Charge, innergemeinschaftliche Lieferung und Drittland zählen
 * auch bei Ist mit der Rechnung (DATEV-Dok. 1080673; NACH_RECHNUNGSDATUM in vat-figures.ts).
 */
const IST_NACH_ZAHLUNG: ReadonlySet<JournalKennzahl> = new Set(["kz81", "kz86", "kz43", "kz48", "steuerfrei"]);

/**
 * Summe der Kennzahlen über die Buchungen eines Zeitraums, je Buchung ihre Zeilen. Bei Ist-Versteuerung zählt wie bei
 * DATEV ein Verkauf auf Ziel (Buchung mit dem Forderungskonto, also Rechnung, Storno, Skonto, Forderungsausfall) mit
 * seiner Bemessungsgrundlage noch nicht; erst die Zahlung meldet sie (das Journal trägt sie dort noch nicht, #542
 * Schritt 4). Verkäufe direkt über Bank oder Kasse zählen sofort.
 */
export function kennzahlenAusJournal(
  kontenrahmen: Kontenrahmen,
  versteuerung: Versteuerung,
  buchungen: readonly (readonly JournalZeile[])[],
): JournalKennzahlen {
  const forderungen = ACCOUNTS[kontenrahmen].forderungen;
  const summe = leereJournalKennzahlen();
  for (const zeilen of buchungen) {
    const aufZiel = versteuerung === "ist" && zeilen.some((z) => z.account === forderungen);
    for (const zeile of zeilen) {
      const treffer = kennzahlDerZeile(kontenrahmen, zeile);
      if (treffer && !(aufZiel && IST_NACH_ZAHLUNG.has(treffer.feld))) summe[treffer.feld] += treffer.betrag;
    }
  }
  return summe;
}
