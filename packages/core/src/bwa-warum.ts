import { imZeitraum, type Zeitraum } from "./bwa-zeitraum.ts";
import { lieferantGruppen } from "./lieferant.ts";
import { roundHalfAwayFromZero, type Cents } from "./money.ts";

/*
 * „Warum?“ je Zeile der BWA (#1380, Teil 2): Die Abweichung einer Zeile zum Vergleichszeitraum, zerlegt nach Kontakt (Kunde
 * bzw. Lieferant). Ohne KI und genau: Jeder Kontakt trägt seine Differenz bei, zusammen ergeben sie die Abweichung auf den
 * Cent. Die Art sagt, wie sie zustande kam: neu (im Vergleich kein Vorgang), weggefallen (jetzt keiner), gestiegen oder gesunken.
 * Anzahl und Betrag je Vorgang trennen eine Preiserhöhung von mehr Vorgängen.
 *
 * Posten desselben Lieferanten bzw. Kunden zählen zusammen, mit und ohne Kontakt (lieferantGruppen: Kontakt, USt-IdNr.,
 * Name, #1514); die Gruppe trägt den Kontakt und seinen Namen. Ohne Kontakt, USt-IdNr. und Namen zählt ein Posten als
 * „Ohne Kontakt“ (Pauschalen, Lohn, Zahlungen an das Finanzamt).
 */

/** Ein Betrag einer Zeile der BWA mit Datum und Kontakt */
export interface WarumPosten {
  datum: string;
  betrag: Cents;
  /** Der Name zeigt die Gruppe; weitere Namen (etwa am Beleg neben dem des Kontakts) und USt-IdNr. verbinden nur */
  kontakt: { id: string | null; name: string; namen?: readonly string[]; ustIds?: readonly string[] };
}

export type WarumArt = "neu" | "gestiegen" | "gesunken" | "weggefallen";

export interface WarumTeil {
  /** Eindeutig je Teil, auch bei zwei Teilen gleichen Namens ohne Kontakt (Schlüssel der Gruppe aus lieferantGruppen) */
  schluessel: string;
  kontaktId: string | null;
  name: string;
  art: WarumArt;
  betrag: Cents;
  vergleich: Cents;
  differenz: Cents;
  anzahl: number;
  anzahlVergleich: number;
  /** Durchschnitt je Vorgang; null ohne Vorgang */
  jeVorgang: Cents | null;
  jeVorgangVergleich: Cents | null;
}

export interface Warum {
  betrag: Cents;
  vergleich: Cents;
  abweichung: Cents;
  /** Die Kontakte mit Differenz, die größte zuerst */
  teile: WarumTeil[];
  /** Zahl der Kontakte mit Beträgen, aber ohne Differenz */
  unveraendert: number;
  /** Was über `hoechstens` hinausgeht, zusammengefasst; null, wenn alles in `teile` steht */
  uebrige: { anzahlKontakte: number; differenz: Cents } | null;
}

export const OHNE_KONTAKT = "Ohne Kontakt";

const jeVorgang = (betrag: Cents, anzahl: number): Cents | null => (anzahl === 0 ? null : roundHalfAwayFromZero(betrag / anzahl));

/** Nach den Vorgängen, nicht nach dem Betrag: Gleichen sich Zahlung und Erstattung aus, gab es trotzdem Vorgänge */
function art({ betrag, vergleich, anzahl, anzahlVergleich }: Pick<WarumTeil, "betrag" | "vergleich" | "anzahl" | "anzahlVergleich">): WarumArt {
  if (anzahlVergleich === 0) return "neu";
  if (anzahl === 0) return "weggefallen";
  return betrag > vergleich ? "gestiegen" : "gesunken";
}

/** Zerlegt die Abweichung von `zeitraum` zu `vergleich` nach Kontakt; Posten außerhalb beider Zeiträume zählen nicht */
export function zerlegeAbweichung(posten: readonly WarumPosten[], zeitraum: Zeitraum, vergleich: Zeitraum, { hoechstens = Infinity } = {}): Warum {
  const zaehlen = posten.filter((p) => imZeitraum(zeitraum, p.datum) || imZeitraum(vergleich, p.datum));
  const gruppen = lieferantGruppen(
    zaehlen.map(({ kontakt }) => ({ kontaktId: kontakt.id, ustIds: kontakt.ustIds ?? [], namen: [kontakt.name, ...(kontakt.namen ?? [])] })),
  );
  const je = new Map<string, Omit<WarumTeil, "art" | "differenz" | "jeVorgang" | "jeVorgangVergleich"> & { datum: string }>();
  zaehlen.forEach((p, i) => {
    const key = gruppen[i] ?? "ohne";
    const k = je.get(key) ?? { schluessel: key, kontaktId: null, name: OHNE_KONTAKT, datum: "", betrag: 0, vergleich: 0, anzahl: 0, anzahlVergleich: 0 };
    // Der Kontakt gibt der Gruppe Link und Namen; der Name des jüngsten Postens gilt, falls er sich geändert hat
    const name = p.kontakt.name.trim();
    if (p.kontakt.id ? !k.kontaktId || p.datum >= k.datum : !k.kontaktId && p.datum >= k.datum && name)
      Object.assign(k, { kontaktId: p.kontakt.id, name: name || k.name, datum: p.datum });
    // Überschneiden sich die Zeiträume (freier Zeitraum über mehr als ein Jahr gegen das Vorjahr), zählt ein Posten wie in
    // der BWA auf beiden Seiten
    if (imZeitraum(zeitraum, p.datum)) {
      k.betrag += p.betrag;
      k.anzahl++;
    }
    if (imZeitraum(vergleich, p.datum)) {
      k.vergleich += p.betrag;
      k.anzahlVergleich++;
    }
    je.set(key, k);
  });
  const alle = [...je.values()].map(
    ({ datum: _datum, ...k }): WarumTeil => ({
      ...k,
      art: art(k),
      differenz: k.betrag - k.vergleich,
      jeVorgang: jeVorgang(k.betrag, k.anzahl),
      jeVorgangVergleich: jeVorgang(k.vergleich, k.anzahlVergleich),
    }),
  );
  const geaendert = alle.filter((t) => t.differenz !== 0).sort((a, b) => Math.abs(b.differenz) - Math.abs(a.differenz) || a.name.localeCompare(b.name, "de"));
  const rest = geaendert.slice(hoechstens);
  const betrag = alle.reduce((s, t) => s + t.betrag, 0);
  const vergleichBetrag = alle.reduce((s, t) => s + t.vergleich, 0);
  return {
    betrag,
    vergleich: vergleichBetrag,
    abweichung: betrag - vergleichBetrag,
    teile: geaendert.slice(0, hoechstens),
    unveraendert: alle.length - geaendert.length,
    uebrige: rest.length === 0 ? null : { anzahlKontakte: rest.length, differenz: rest.reduce((s, t) => s + t.differenz, 0) },
  };
}
