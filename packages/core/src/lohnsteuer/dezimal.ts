/**
 * Kleine Dezimalarithmetik auf Basis von `bigint` für den Programmablaufplan (PAP) der Lohnsteuer.
 *
 * Der PAP ist in Java mit `BigDecimal` formuliert und schreibt jede Rundung ausdrücklich vor
 * (`setScale(2, ROUND_DOWN)`, `divide(ZAHL12, 0, ROUND_DOWN)` …). Gleitkommazahlen träfen diese Rundungen
 * nicht verlässlich (0,42 · 78.069 ergibt 32.788,979999… statt 32.788,98). Eine Zahl ist hier ein ganzzahliger
 * Wert mit Anzahl der Nachkommastellen: 0,093 = { wert: 93n, stellen: 3 }.
 *
 * Ergebnisse vergleicht und rundet der PAP nur nach dem Zahlenwert; die Nachkommastellen eines Zwischenwerts
 * (in Java `scale`) ändern an keinem Ergebnis etwas, solange jede Rundung ausdrücklich steht.
 */

export interface Dezimal {
  readonly wert: bigint;
  readonly stellen: number;
}

/**
 * Rundungsarten des PAP: `ab` ist `BigDecimal.ROUND_DOWN` (Richtung null, die Ziffern fallen weg), `auf` ist
 * `BigDecimal.ROUND_UP` (von null weg). Der PAP rundet negative Zahlen „nach ihrem Betrag“, wie Java.
 */
export type Rundung = "ab" | "auf";

const zehnHoch = (n: number): bigint => 10n ** BigInt(n);

/** Dezimalzahl aus Text wie im PAP-XML: "0.093", "101400", "-1.5" */
export function dez(text: string): Dezimal {
  const treffer = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!treffer) throw new RangeError(`Keine Dezimalzahl: ${text}`);
  const [, vorzeichen, ganz, bruch = ""] = treffer;
  const betrag = BigInt(ganz! + bruch);
  return { wert: vorzeichen ? -betrag : betrag, stellen: bruch.length };
}

/** Ganze Zahl (etwa Cent als `number`) mit gegebenen Nachkommastellen: ganzzahl(250, 4) = 0,0250 */
export function ganzzahl(n: number, stellen = 0): Dezimal {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Keine ganze Zahl: ${n}`);
  return { wert: BigInt(n), stellen };
}

export const NULL: Dezimal = { wert: 0n, stellen: 0 };

function aufStellen(a: Dezimal, stellen: number): bigint {
  return a.wert * zehnHoch(stellen - a.stellen);
}

export function plus(a: Dezimal, b: Dezimal): Dezimal {
  const stellen = Math.max(a.stellen, b.stellen);
  return { wert: aufStellen(a, stellen) + aufStellen(b, stellen), stellen };
}

export function minus(a: Dezimal, b: Dezimal): Dezimal {
  return plus(a, { wert: -b.wert, stellen: b.stellen });
}

export function mal(a: Dezimal, b: Dezimal): Dezimal {
  return { wert: a.wert * b.wert, stellen: a.stellen + b.stellen };
}

/** Ganzzahlige Division mit Rundung `ab` (Richtung null) oder `auf` (von null weg) */
function teile(zaehler: bigint, nenner: bigint, rundung: Rundung): bigint {
  const quotient = zaehler / nenner; // bigint-Division schneidet Richtung null ab
  if (rundung === "ab" || quotient * nenner === zaehler) return quotient;
  return (zaehler < 0n) !== (nenner < 0n) ? quotient - 1n : quotient + 1n;
}

/** `setScale(stellen, ROUND_DOWN | ROUND_UP)` */
export function runden(a: Dezimal, stellen: number, rundung: Rundung): Dezimal {
  if (stellen >= a.stellen) return { wert: aufStellen(a, stellen), stellen };
  return { wert: teile(a.wert, zehnHoch(a.stellen - stellen), rundung), stellen };
}

/** `divide(b, stellen, ROUND_DOWN | ROUND_UP)` */
export function geteilt(a: Dezimal, b: Dezimal, stellen: number, rundung: Rundung): Dezimal {
  if (b.wert === 0n) throw new RangeError("Division durch null");
  // a / b = (a.wert / 10^a.stellen) / (b.wert / 10^b.stellen); Ergebnis mit `stellen` Nachkommastellen
  const exponent = stellen + b.stellen - a.stellen;
  const zaehler = exponent >= 0 ? a.wert * zehnHoch(exponent) : a.wert;
  const nenner = exponent >= 0 ? b.wert : b.wert * zehnHoch(-exponent);
  return { wert: teile(zaehler, nenner, rundung), stellen };
}

/**
 * `divide(b)` ohne Rundung: Java liefert den genauen Quotienten oder wirft eine Ausnahme, wenn er nicht
 * abbricht. Der PAP teilt so nur durch 2, 12 (bei Versorgungsbezügen) und 100.
 */
export function geteiltExakt(a: Dezimal, b: Dezimal): Dezimal {
  for (let stellen = a.stellen; stellen <= a.stellen + 40; stellen++) {
    const ab = geteilt(a, b, stellen, "ab");
    if (ab.wert === geteilt(a, b, stellen, "auf").wert) return ab;
  }
  throw new RangeError("Die Division bricht nicht ab");
}

/** `compareTo`: −1, 0 oder 1 */
export function vergleich(a: Dezimal, b: Dezimal): -1 | 0 | 1 {
  const differenz = minus(a, b).wert;
  return differenz < 0n ? -1 : differenz > 0n ? 1 : 0;
}

export const groesser = (a: Dezimal, b: Dezimal): boolean => vergleich(a, b) === 1;
export const kleiner = (a: Dezimal, b: Dezimal): boolean => vergleich(a, b) === -1;
export const kleinster = (a: Dezimal, b: Dezimal): Dezimal => (groesser(a, b) ? b : a);
export const groesster = (a: Dezimal, b: Dezimal): Dezimal => (kleiner(a, b) ? b : a);

/** Ganzzahliger Wert als `number`; nur für Werte ohne Nachkommastellen, etwa Cent am Ende des PAP */
export function alsGanzzahl(a: Dezimal): number {
  const ganz = runden(a, 0, "ab");
  if (vergleich(ganz, a) !== 0) throw new RangeError("Wert hat Nachkommastellen");
  const n = Number(ganz.wert);
  if (!Number.isSafeInteger(n)) throw new RangeError("Wert zu groß");
  return n;
}

/** Text mit Punkt als Dezimaltrenner, für Tests und Fehlermeldungen */
export function alsText(a: Dezimal): string {
  const betrag = (a.wert < 0n ? -a.wert : a.wert).toString().padStart(a.stellen + 1, "0");
  const ganz = betrag.slice(0, betrag.length - a.stellen);
  const bruch = a.stellen > 0 ? `.${betrag.slice(betrag.length - a.stellen)}` : "";
  return `${a.wert < 0n ? "-" : ""}${ganz}${bruch}`;
}
