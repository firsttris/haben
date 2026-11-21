import { addDays } from "./holidays.ts";
import type { Cents } from "./money.ts";
import { addMonthsAnchored } from "./recurring.ts";

/*
 * Liquiditätsvorschau (#1381): Aus dem Kontostand und einer Liste datierter Posten (Zahlungen, die kommen werden) entsteht
 * der Verlauf je Tag und je Woche oder Monat mit dem Tiefpunkt. Ohne Datenbank: Woher ein Posten kommt (offene Rechnung,
 * Dauerbeleg, Umsatzsteuer, Vorauszahlung), entscheiden die Adapter im Server-Modul `liquiditaet`; Planposten und Szenarien
 * sind später nur weitere Posten.
 */

/**
 * Wie sicher ein Posten ist: **fest** = Betrag und Termin stehen (abgegebene Voranmeldung, Verbindlichkeit mit
 * Fälligkeit), **erwartet** = der Betrag kommt aus Rechnung, Voranmeldung, Vorlage oder letzter Zahlung, ob und wann er
 * fließt, ist offen (offene Rechnung, Erstattung aus der Voranmeldung, Dauerbeleg, wiederkehrende Rechnung, fortgeschriebene
 * Vorauszahlung), **geschätzt** = der Betrag ist gerechnet (laufende Umsatzsteuer, Vorauszahlung
 * aus der Prognose, überfällige Forderung).
 */
export const SICHERHEITEN = { fest: "fest", erwartet: "erwartet", geschaetzt: "geschätzt" } as const;
export type Sicherheit = keyof typeof SICHERHEITEN;

/** Woher ein Posten kommt; die Seite verlinkt danach auf die Quelle */
export const LIQUIDITAET_QUELLEN = {
  rechnung: "Rechnung",
  beleg: "Beleg",
  dauerbeleg: "Dauerbeleg",
  wiederkehrend: "Wiederkehrende Rechnung",
  voranmeldung: "Voranmeldung",
  umsatzsteuer: "Umsatzsteuer",
  sondervorauszahlung: "Sondervorauszahlung",
  vorauszahlung: "Vorauszahlung",
} as const;
export type LiquiditaetsQuelle = keyof typeof LIQUIDITAET_QUELLEN;

export interface LiquiditaetsPosten {
  /** Tag, an dem das Geld fließt (JJJJ-MM-TT) */
  datum: string;
  /** Immer positiv; die Richtung sagt, ob es kommt oder geht */
  betrag: Cents;
  richtung: "ein" | "aus";
  /** Was es ist, etwa „RE-2026-0012 · Muster GmbH“ */
  text: string;
  /** Art der Quelle und ihre ID (bei Voranmeldung und Umsatzsteuer der Zeitraum, etwa „2026-Q3“) */
  quelle: { art: LiquiditaetsQuelle; id: string };
  sicherheit: Sicherheit;
  /** Geht über das Geschäftskonto, ist aber privat, etwa die Einkommensteuer im Einzelunternehmen (§ 12 Nr. 3 EStG) */
  privat?: boolean;
  /** Der eigentliche Termin lag vor heute; der Posten steht deshalb heute bzw. am nächsten Werktag */
  ueberfaellig?: boolean;
  /**
   * Umsatzsteuer (positiv) bzw. Vorsteuer (negativ), die der Posten in einem noch nicht abgegebenen Voranmeldungszeitraum
   * auslöst, mit dem Tag, an dem sie entsteht (Ist: Zahlungseingang, Soll: Ende der Leistung; Vorsteuer: Belegdatum). Daraus
   * schätzt `umsatzsteuerPosten` die Zahllast.
   */
  steuer?: { betrag: Cents; datum: string };
}

/** Vorzeichenbehafteter Betrag: Eingang positiv, Ausgang negativ */
export const wirkung = (p: Pick<LiquiditaetsPosten, "betrag" | "richtung">): Cents => (p.richtung === "ein" ? p.betrag : -p.betrag);

/** Posten aus einem vorzeichenbehafteten Betrag; 0 ergibt keinen */
export function postenAus(betrag: Cents, rest: Omit<LiquiditaetsPosten, "betrag" | "richtung">): LiquiditaetsPosten[] {
  if (betrag === 0) return [];
  return [{ ...rest, betrag: Math.abs(betrag), richtung: betrag > 0 ? "ein" : "aus" }];
}

/** Horizonte der Vorschau: zwei je Woche, zwei je Monat */
export const HORIZONTE = {
  "4w": { label: "4 Wochen", raster: "woche", wochen: 4 },
  "13w": { label: "13 Wochen", raster: "woche", wochen: 13 },
  "6m": { label: "6 Monate", raster: "monat", monate: 6 },
  "12m": { label: "12 Monate", raster: "monat", monate: 12 },
} as const;
export type Horizont = keyof typeof HORIZONTE;
export const HORIZONT_KEYS = Object.keys(HORIZONTE) as [Horizont, ...Horizont[]];

/** Letzter Tag des Horizonts, einschließlich: 4 Wochen ab Freitag, dem 20., enden am Donnerstag, dem 17. des Folgemonats */
export function horizontEnde(heute: string, horizont: Horizont): string {
  const h = HORIZONTE[horizont];
  if ("wochen" in h) return addDays(heute, h.wochen * 7 - 1);
  return addDays(addMonthsAnchored(heute, h.monate, Number(heute.slice(8, 10))), -1);
}

const wochentag = (datum: string) => new Date(`${datum}T00:00:00Z`).getUTCDay();

/** Letzter Tag des Zeitraums, in dem `datum` liegt: Sonntag der Woche (ISO 8601, Montag bis Sonntag) bzw. Monatsende */
function zeitraumEnde(datum: string, raster: "woche" | "monat"): string {
  if (raster === "woche") return addDays(datum, (7 - wochentag(datum)) % 7);
  return addDays(addMonthsAnchored(`${datum.slice(0, 7)}-01`, 1, 1), -1);
}

/** Zeiträume der Tabelle: erste Woche bzw. erster Monat ab heute, der letzte bis zum Ende des Horizonts, beide angeschnitten */
export function vorschauZeitraeume(heute: string, horizont: Horizont): { von: string; bis: string }[] {
  const ende = horizontEnde(heute, horizont);
  const raster = HORIZONTE[horizont].raster;
  const zeitraeume: { von: string; bis: string }[] = [];
  for (let von = heute; von <= ende; ) {
    const bis = zeitraumEnde(von, raster);
    zeitraeume.push({ von, bis: [bis, ende].sort()[0]! });
    von = addDays(bis, 1);
  }
  return zeitraeume;
}

export interface Stand {
  datum: string;
  /** Kontostand am Ende des Tages */
  stand: Cents;
}

export interface ZeitraumStand {
  von: string;
  bis: string;
  anfang: Cents;
  eingaenge: Cents;
  /** Positiv */
  ausgaenge: Cents;
  ende: Cents;
  /** Niedrigster Tagesendstand im Zeitraum */
  tiefpunkt: Stand;
  posten: LiquiditaetsPosten[];
}

export interface Vorschau {
  heute: string;
  bis: string;
  horizont: Horizont;
  /** Kontostand zu Beginn, vor den heute fälligen Posten */
  start: Cents;
  /** Tagesendstand an jedem Tag mit Posten, für die Kurve */
  verlauf: Stand[];
  zeitraeume: ZeitraumStand[];
  /** Niedrigster Tagesendstand im Horizont; ohne Posten der Stand heute */
  tiefpunkt: Stand;
  eingaenge: Cents;
  ausgaenge: Cents;
  ende: Cents;
}

/**
 * Posten vor heute rücken auf heute, wie eine überfällige Verbindlichkeit, die noch zu zahlen ist; Posten nach dem Ende
 * des Horizonts fallen weg. Sortiert nach Tag, am selben Tag Eingänge zuerst, dann nach Text.
 */
export function imHorizont(posten: readonly LiquiditaetsPosten[], heute: string, bis: string): LiquiditaetsPosten[] {
  return posten
    .filter((p) => p.datum <= bis)
    .map((p) => (p.datum < heute ? { ...p, datum: heute, ueberfaellig: true } : p))
    .sort((a, b) => a.datum.localeCompare(b.datum) || b.richtung.localeCompare(a.richtung) || a.text.localeCompare(b.text));
}

/** Tagesendstände: Start plus alle Posten bis einschließlich des Tages, je Tag mit Posten ein Stand */
function tagesstaende(start: Cents, posten: readonly LiquiditaetsPosten[]): Stand[] {
  const verlauf: Stand[] = [];
  let stand = start;
  for (const p of posten) {
    stand += wirkung(p);
    const letzter = verlauf.at(-1);
    if (letzter?.datum === p.datum) letzter.stand = stand;
    else verlauf.push({ datum: p.datum, stand });
  }
  return verlauf;
}

/** Niedrigster Stand; bei Gleichstand der frühere Tag */
const tiefster = (staende: readonly Stand[], ohne: Stand): Stand => staende.reduce((min, s) => (s.stand < min.stand ? s : min), ohne);

/**
 * Vorschau über den Horizont: Verlauf je Tag, Zeiträume je Woche oder Monat und der Tiefpunkt. Der Stand eines Tages ist
 * der Start plus alles, was bis einschließlich dieses Tages fällig ist; die Vorschau für morgen ist also der Kontostand
 * plus/minus der heute und morgen fälligen Posten.
 */
export function liquiditaetsVorschau(input: { heute: string; horizont: Horizont; start: Cents; posten: readonly LiquiditaetsPosten[] }): Vorschau {
  const { heute, horizont, start } = input;
  const bis = horizontEnde(heute, horizont);
  const posten = imHorizont(input.posten, heute, bis);
  const verlauf = tagesstaende(start, posten);
  let anfang = start;
  const zeitraeume = vorschauZeitraeume(heute, horizont).map(({ von, bis: zbis }): ZeitraumStand => {
    const darin = posten.filter((p) => p.datum >= von && p.datum <= zbis);
    const eingaenge = darin.filter((p) => p.richtung === "ein").reduce((s, p) => s + p.betrag, 0);
    const ausgaenge = darin.filter((p) => p.richtung === "aus").reduce((s, p) => s + p.betrag, 0);
    const ende = anfang + eingaenge - ausgaenge;
    const tiefpunkt = tiefster(
      verlauf.filter((s) => s.datum >= von && s.datum <= zbis),
      { datum: von, stand: anfang },
    );
    const stand: ZeitraumStand = { von, bis: zbis, anfang, eingaenge, ausgaenge, ende, tiefpunkt, posten: darin };
    anfang = ende;
    return stand;
  });
  const eingaenge = zeitraeume.reduce((s, z) => s + z.eingaenge, 0);
  const ausgaenge = zeitraeume.reduce((s, z) => s + z.ausgaenge, 0);
  return {
    heute,
    bis,
    horizont,
    start,
    verlauf,
    zeitraeume,
    tiefpunkt: tiefster(verlauf, { datum: heute, stand: start }),
    eingaenge,
    ausgaenge,
    ende: start + eingaenge - ausgaenge,
  };
}
