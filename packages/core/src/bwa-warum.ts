import { imZeitraum, type Zeitraum } from "./bwa-zeitraum.ts";
import { roundHalfAwayFromZero, type Cents } from "./money.ts";

/*
 * „Warum?“ je Zeile der BWA (#1380, Teil 2): Die Abweichung einer Zeile zum Vergleichszeitraum, zerlegt nach Kontakt (Kunde
 * bzw. Lieferant). Ohne KI und genau: Jeder Kontakt trägt seine Differenz bei, zusammen ergeben sie die Abweichung auf den
 * Cent. Die Art sagt, wie sie zustande kam: neu (im Vergleich nichts), weggefallen (jetzt nichts), gestiegen oder gesunken.
 * Anzahl und Betrag je Vorgang trennen eine Preiserhöhung von mehr Vorgängen.
 *
 * Ein Posten ohne Kontakt zählt nach dem Namen am Beleg (Lieferant ohne Eintrag in den Kontakten), ohne Namen als
 * „Ohne Kontakt“ (Pauschalen, Lohn, Zahlungen an das Finanzamt).
 */

/** Ein Betrag einer Zeile der BWA mit Datum und Kontakt */
export interface WarumPosten {
  datum: string;
  betrag: Cents;
  kontakt: { id: string | null; name: string };
}

export type WarumArt = "neu" | "gestiegen" | "gesunken" | "weggefallen";

export interface WarumTeil {
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

const schluessel = ({ id, name }: WarumPosten["kontakt"]) => (id ? `id:${id}` : name.trim() ? `name:${name.trim().toLocaleLowerCase("de")}` : "ohne");

const jeVorgang = (betrag: Cents, anzahl: number): Cents | null => (anzahl === 0 ? null : roundHalfAwayFromZero(betrag / anzahl));

function art(betrag: Cents, vergleich: Cents): WarumArt {
  if (vergleich === 0) return "neu";
  if (betrag === 0) return "weggefallen";
  return betrag > vergleich ? "gestiegen" : "gesunken";
}

/** Zerlegt die Abweichung von `zeitraum` zu `vergleich` nach Kontakt; Posten außerhalb beider Zeiträume zählen nicht */
export function zerlegeAbweichung(posten: readonly WarumPosten[], zeitraum: Zeitraum, vergleich: Zeitraum, { hoechstens = Infinity } = {}): Warum {
  const je = new Map<string, Omit<WarumTeil, "art" | "differenz" | "jeVorgang" | "jeVorgangVergleich"> & { datum: string }>();
  for (const p of posten) {
    const imZeitraumP = imZeitraum(zeitraum, p.datum);
    if (!imZeitraumP && !imZeitraum(vergleich, p.datum)) continue;
    const key = schluessel(p.kontakt);
    const k = je.get(key) ?? {
      kontaktId: p.kontakt.id,
      name: p.kontakt.name.trim() || OHNE_KONTAKT,
      datum: "",
      betrag: 0,
      vergleich: 0,
      anzahl: 0,
      anzahlVergleich: 0,
    };
    // Der Name des jüngsten Postens gilt, falls er sich geändert hat
    if (p.datum >= k.datum && p.kontakt.name.trim()) Object.assign(k, { name: p.kontakt.name.trim(), datum: p.datum });
    if (imZeitraumP) {
      k.betrag += p.betrag;
      k.anzahl++;
    } else {
      k.vergleich += p.betrag;
      k.anzahlVergleich++;
    }
    je.set(key, k);
  }
  const alle = [...je.values()].map(
    ({ datum: _datum, ...k }): WarumTeil => ({
      ...k,
      art: art(k.betrag, k.vergleich),
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
