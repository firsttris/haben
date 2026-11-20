import { addDays, type Cents } from "@haben/core";
import { listAccounts } from "../bank/index.ts";

/*
 * Kontostände zu Beginn der Vorschau. Vorschlag in #1381, bis der Maintainer entscheidet: Geschäfts-, Steuer- und
 * Zahlungsdienstleisterkonten bilden den Bestand, Rücklagekonten stehen daneben, private Konten zählen nicht; ausgeschlossene
 * Konten liefert `listAccounts` gar nicht erst. Der Stand ist der Schlusssaldo des letzten Imports (bei Zahlungsdienstleistern
 * die Summe der Umsätze); ist er älter als drei Tage, zeigt die Seite einen Hinweis mit Datum.
 */

/** Ab so vielen Tagen gilt ein Kontostand als alt */
export const ALTER_KONTOSTAND_TAGE = 3;

export interface Kontostand {
  id: string;
  name: string;
  zweck: "geschaeft" | "steuer" | "ruecklage" | "zahlungsdienstleister";
  /** null: kein Saldo bekannt (Datei-Import ohne Saldo oder noch nichts importiert) */
  stand: Cents | null;
  /** Tag des Stands; null ohne Import */
  datum: string | null;
  /** Älter als drei Tage */
  alt: boolean;
  /** Umsätze, die noch keiner Rechnung oder keinem Beleg zugeordnet sind: deren Posten stehen noch offen in der Vorschau */
  offeneUmsaetze: number;
}

export interface Kontostaende {
  konten: Kontostand[];
  /** Summe der Konten im Bestand mit bekanntem Stand */
  bestand: Cents;
  /** Summe der Rücklagekonten, nur ausgewiesen */
  ruecklage: Cents;
}

export async function kontostaende(heute: string): Promise<Kontostaende> {
  const konten = (await listAccounts())
    .filter((a) => a.purpose !== "privat")
    .map((a): Kontostand => {
      const datum = a.lastImport?.periodTo ?? null;
      const stand = a.purpose === "zahlungsdienstleister" ? a.providerBalance : (a.lastImport?.closingBalance ?? null);
      return {
        id: a.id,
        name: a.name,
        zweck: a.purpose as Kontostand["zweck"],
        stand,
        datum,
        alt: datum !== null && datum < addDays(heute, -ALTER_KONTOSTAND_TAGE),
        offeneUmsaetze: a.openCount,
      };
    });
  const summe = (liste: Kontostand[]) => liste.reduce((s, k) => s + (k.stand ?? 0), 0);
  return {
    konten,
    bestand: summe(konten.filter((k) => k.zweck !== "ruecklage")),
    ruecklage: summe(konten.filter((k) => k.zweck === "ruecklage")),
  };
}
