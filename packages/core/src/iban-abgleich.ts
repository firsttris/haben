import { compactIban } from "./sepa-text.ts";

/**
 * Abgleich der IBAN aus einer E-Rechnung (EN 16931, BT-84 „Payment account identifier“) mit der IBAN im Kontakt des
 * Lieferanten (#410). Eine geänderte Bankverbindung in einer Rechnung ist ein bekanntes Betrugsmuster (abgefangene
 * Rechnung, ausgetauschte IBAN); deshalb gilt eine abweichende IBAN erst nach ausdrücklicher Entscheidung je Beleg, und
 * nur für genau dieses Paar aus Kontakt- und Rechnungs-IBAN.
 */

export type IbanWahl = "kontakt" | "e-rechnung";

export interface IbanQuellen {
  /** IBAN im Kontakt des Lieferanten, leer = keine */
  kontaktIban: string | null;
  /** IBAN aus der E-Rechnung (BT-84), leer = keine */
  rechnungsIban: string | null;
}

export interface IbanEntscheidung {
  kontaktIban: string;
  rechnungsIban: string;
  wahl: IbanWahl;
  am: Date;
  /** Wer entschieden hat (Name oder Kennung) */
  von: string;
}

export type IbanAbgleich =
  | { art: "keine" }
  | { art: "ungeprueft"; rechnungsIban: string }
  | { art: "gleich" }
  | { art: "abweichend"; kontaktIban: string; rechnungsIban: string; entscheidung: IbanEntscheidung | null };

const kompakt = (iban: string | null) => (iban && iban.trim() !== "" ? compactIban(iban) : null);

/** Was der Beleg über die IBAN sagt; Entscheidungen in beliebiger Reihenfolge, die jüngste passende gilt */
export function ibanAbgleich(quellen: IbanQuellen, entscheidungen: IbanEntscheidung[]): IbanAbgleich {
  const kontaktIban = kompakt(quellen.kontaktIban);
  const rechnungsIban = kompakt(quellen.rechnungsIban);
  if (!rechnungsIban) return { art: "keine" };
  if (!kontaktIban) return { art: "ungeprueft", rechnungsIban };
  if (kontaktIban === rechnungsIban) return { art: "gleich" };
  const passend = entscheidungen
    .filter((e) => compactIban(e.kontaktIban) === kontaktIban && compactIban(e.rechnungsIban) === rechnungsIban)
    .sort((a, b) => b.am.getTime() - a.am.getTime());
  return { art: "abweichend", kontaktIban, rechnungsIban, entscheidung: passend[0] ?? null };
}

export type GeltendeIban =
  | { iban: string; herkunft: IbanWahl; entschieden?: true }
  /** Ohne IBAN, oder abweichend und noch nicht entschieden (offen) */
  | { iban: null; herkunft: null; offen?: true };

/** Welche IBAN für eine Überweisung gilt; abweichend ohne Entscheidung keine */
export function geltendeIban(quellen: IbanQuellen, entscheidungen: IbanEntscheidung[]): GeltendeIban {
  const abgleich = ibanAbgleich(quellen, entscheidungen);
  switch (abgleich.art) {
    case "keine": {
      const kontaktIban = kompakt(quellen.kontaktIban);
      return kontaktIban ? { iban: kontaktIban, herkunft: "kontakt" } : { iban: null, herkunft: null };
    }
    case "ungeprueft":
      return { iban: abgleich.rechnungsIban, herkunft: "e-rechnung" };
    case "gleich":
      return { iban: kompakt(quellen.kontaktIban)!, herkunft: "kontakt" };
    case "abweichend": {
      const e = abgleich.entscheidung;
      if (!e) return { iban: null, herkunft: null, offen: true };
      return { iban: e.wahl === "kontakt" ? abgleich.kontaktIban : abgleich.rechnungsIban, herkunft: e.wahl, entschieden: true };
    }
  }
}

/** IBAN in Vierergruppen, wie auf Papier und im Online-Banking */
export function gruppierteIban(iban: string): string {
  return compactIban(iban)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}
