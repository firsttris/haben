import { addDays, publicHolidays } from "../holidays.ts";
import { BUNDESLAENDER, type Bundesland } from "../steuernummer.ts";

/*
 * Termine der Sozialversicherung für die Ausfüllliste (docs/lohn-plan.md, PR 6).
 *
 * Beiträge: fällig am drittletzten Bankarbeitstag des Monats, in dem gearbeitet wird (§ 23 Abs. 1 Satz 2 SGB IV,
 * https://www.gesetze-im-internet.de/sgb_4/__23.html). Beitragsnachweis: „zwei Arbeitstage vor Fälligkeit“ (§ 28f
 * Abs. 3 Satz 1 SGB IV, https://www.gesetze-im-internet.de/sgb_4/__28f.html); nach den Spitzenorganisationen muss er
 * der Einzugsstelle um 0 Uhr des fünftletzten Bankarbeitstags vorliegen, also am Tag davor übermittelt sein
 * (TK-Beratungsblatt „Beitragsnachweis“ 07/2026, Abschnitt 4 und Tabelle der Fälligkeitstermine).
 *
 * Bankarbeitstage: keine Samstage, Sonntage und gesetzlichen Feiertage am Sitz der Krankenkasse; der 24. und 31.
 * Dezember sind nach den geschäftsfreien Tagen der Deutschen Bundesbank auch keine (TK, „Zu welchem Zeitpunkt sind die
 * Beiträge fällig?“). Den Sitz der Kasse kennt Haben nicht; es zählt deshalb jeden Feiertag, der in irgendeinem Land
 * gilt. Das ergibt den frühesten möglichen Termin, nie einen zu späten.
 */

const LAENDER = Object.keys(BUNDESLAENDER) as Bundesland[];
const feiertageCache = new Map<number, Set<string>>();

/** Feiertage, die in mindestens einem Land gelten */
function feiertageIrgendwo(jahr: number): Set<string> {
  let tage = feiertageCache.get(jahr);
  if (!tage) {
    tage = new Set(LAENDER.flatMap((land) => [...publicHolidays(jahr, land).keys()]));
    feiertageCache.set(jahr, tage);
  }
  return tage;
}

export function istBankarbeitstag(iso: string): boolean {
  const wochentag = new Date(`${iso}T00:00:00Z`).getUTCDay();
  if (wochentag === 0 || wochentag === 6) return false;
  if (iso.endsWith("-12-24") || iso.endsWith("-12-31")) return false;
  return !feiertageIrgendwo(Number(iso.slice(0, 4))).has(iso);
}

/** Der n-letzte Bankarbeitstag des Monats (n = 1 ist der letzte) */
function nLetzterBankarbeitstag(jahr: number, monat: number, n: number): string {
  const tage = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  let tag = `${jahr}-${String(monat).padStart(2, "0")}-${String(tage).padStart(2, "0")}`;
  let gezaehlt = 0;
  for (;;) {
    if (istBankarbeitstag(tag)) gezaehlt += 1;
    if (gezaehlt === n) return tag;
    tag = addDays(tag, -1);
  }
}

export interface Beitragstermine {
  /** Drittletzter Bankarbeitstag: Beiträge fällig */
  faelligkeit: string;
  /** Fünftletzter Bankarbeitstag: Der Beitragsnachweis liegt um 0 Uhr vor */
  nachweisVorliegen: string;
  /** Letzter Tag, an dem der Beitragsnachweis übermittelt sein muss (bis 24 Uhr) */
  nachweisBis: string;
}

export function beitragstermine(jahr: number, monat: number): Beitragstermine {
  const nachweisVorliegen = nLetzterBankarbeitstag(jahr, monat, 5);
  return { faelligkeit: nLetzterBankarbeitstag(jahr, monat, 3), nachweisVorliegen, nachweisBis: addDays(nachweisVorliegen, -1) };
}

/*
 * DEÜV-Meldungen: „mit der ersten folgenden Lohn- und Gehaltsabrechnung, spätestens innerhalb von sechs Wochen“ (§ 6
 * Anmeldung, § 8 Abs. 1 Abmeldung) bzw. „spätestens bis zum 15. Februar des folgenden Jahres“ (§ 10 Abs. 1
 * Jahresmeldung), https://www.gesetze-im-internet.de/de_v/. Als Tag der Abrechnung nimmt Haben den Zahltag eines
 * Lohnlaufs; es zählt der frühere der beiden Termine. Ein Ende am Wochenende verschiebt Haben nicht: früher ist sicher.
 */

const SECHS_WOCHEN = 42;

const frueher = (a: string, b: string | undefined) => (b !== undefined && b < a ? b : a);
const ersterZahltag = (zahltage: readonly string[], ab: (tag: string) => boolean) => [...zahltage].sort().find(ab);

/** Anmeldung (Meldegrund 10) */
export function anmeldungFrist(beginn: string, zahltage: readonly string[]): string {
  return frueher(
    addDays(beginn, SECHS_WOCHEN),
    ersterZahltag(zahltage, (z) => z >= beginn),
  );
}

/** Abmeldung (Meldegrund 30) */
export function abmeldungFrist(ende: string, zahltage: readonly string[]): string {
  return frueher(
    addDays(ende, SECHS_WOCHEN),
    ersterZahltag(zahltage, (z) => z > ende),
  );
}

/** Jahresmeldung (Meldegrund 50) für das Jahr */
export function jahresmeldungFrist(jahr: number, zahltage: readonly string[]): string {
  return frueher(
    `${jahr + 1}-02-15`,
    ersterZahltag(zahltage, (z) => z > `${jahr}-12-31`),
  );
}
