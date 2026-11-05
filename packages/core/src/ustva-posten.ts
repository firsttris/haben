import type { Cents } from "./money.ts";
import { MONTHS, periodRange, type VatPeriod } from "./period.ts";

/*
 * Voranmeldung als offener Posten: Jede abgegebene Voranmeldung (über ERiC oder außerhalb von Haben abgegeben und
 * vermerkt) ist eine Forderung des Finanzamts über die Zahllast (Kz 83) bzw. bei einem Überschuss eine Erstattung.
 * Eine berichtigte Anmeldung ist ein eigener Posten über die Differenz zur berichtigten. Zahlungen im Bankabgleich
 * („Umsatzsteuer an das Finanzamt“, SKR03 1780 / SKR04 3820) tragen den Bezug auf die Voranmeldung.
 */

/** Eine abgegebene (gesendete oder vermerkte) Voranmeldung */
export interface FiledVatReturn {
  id: string;
  year: number;
  /** Zeitraum-Schlüssel wie in ELSTER: 1–12 Monate, 41–44 Quartale */
  month: number;
  kz83: Cents;
  /** Bei einer berichtigten Anmeldung die berichtigte (zuletzt abgegebene) */
  correctsId: string | null;
  /** Tag der Abgabe (Eingang beim Finanzamt), JJJJ-MM-TT */
  abgabeTag: string;
}

export interface VatPosten {
  vatReturnId: string;
  year: number;
  month: number;
  /** Zahllast positiv (Ausgang), Erstattung negativ (Eingang); bei einer Berichtigung die Differenz */
  betrag: Cents;
  berichtigt: boolean;
  /** Fälligkeit der Zahlung bzw. frühester Tag der Erstattung */
  faellig: string;
}

/**
 * Fällig ist die Vorauszahlung am 10. Tag nach Ablauf des Zeitraums (§ 18 Abs. 1 Satz 4 UStG, mit Dauerfristverlängerung
 * einen Monat später, § 46 UStDV; `gesetzlich` aus `dueDate`), aber nicht vor dem Eingang der Anmeldung: Vorher tritt keine
 * Säumnis ein (§ 240 Abs. 1 Satz 3 AO). Das betrifft verspätete Anmeldungen und den Mehrbetrag einer Berichtigung.
 */
export function vatPostenFaelligkeit(gesetzlich: string, abgabeTag: string): string {
  return abgabeTag > gesetzlich ? abgabeTag : gesetzlich;
}

/**
 * Posten je abgegebener Voranmeldung: die erste eines Zeitraums über Kz 83, jede Berichtigung über die Differenz zur
 * berichtigten. Posten über 0 € entfallen. `faelligkeit` liefert die gesetzliche Fälligkeit des Zeitraums.
 */
export function vatPosten(returns: readonly FiledVatReturn[], faelligkeit: (period: VatPeriod) => string): VatPosten[] {
  const byId = new Map(returns.map((r) => [r.id, r]));
  return returns
    .map((r) => {
      const vorher = r.correctsId ? byId.get(r.correctsId) : undefined;
      return {
        vatReturnId: r.id,
        year: r.year,
        month: r.month,
        betrag: r.kz83 - (vorher?.kz83 ?? 0),
        berichtigt: r.correctsId !== null,
        faellig: vatPostenFaelligkeit(faelligkeit(r), r.abgabeTag),
      };
    })
    .filter((p) => p.betrag !== 0)
    .sort((a, b) => a.faellig.localeCompare(b.faellig) || a.year - b.year || a.month - b.month);
}

/**
 * Zahlung an das bzw. vom Finanzamt im Bankabgleich (Zuordnung „Umsatzsteuer an das Finanzamt“). Aufgehobene Zuordnungen
 * samt Gegenzeile lässt der Aufrufer weg.
 */
export interface VatPayment {
  id: string;
  /** Bezug auf die Voranmeldung; ältere Zuordnungen und Buchungen ohne Bezug haben keinen */
  vatReturnId: string | null;
  /** Vorzeichen wie auf dem Konto: Lastschrift negativ, Erstattung positiv; Aufhebungen als Gegenzeile */
  amount: Cents;
  bookingDate: string;
}

export interface VatPostenStand extends VatPosten {
  /** Bezahlt bzw. erstattet, mit dem Vorzeichen des Postens */
  bezahlt: Cents;
  /**
   * Mit einem Posten in Gegenrichtung desselben Zeitraums verrechnet, mit dem Vorzeichen des Postens: senkt eine
   * Berichtigung die noch nicht bezahlte Zahllast, schuldet man nur noch den Rest
   */
  verrechnet: Cents;
  /** Noch offen, mit dem Vorzeichen des Postens (Zahllast positiv, Erstattung negativ) */
  offen: Cents;
  zahlungen: (VatPayment & { ohneBezug: boolean })[];
}

/**
 * Stand der Posten nach den Zahlungen. Zahlungen mit Bezug zählen für ihren Posten (Teilzahlungen). Zahlungen ohne Bezug (vor dieser Funktion zugeordnet, oder direkt als „Umsatzsteuer an das Finanzamt“
 * gebucht) gleichen einen Posten nur aus, wenn sie ihn genau treffen: noch ganz offen, gleicher Betrag, gebucht nach
 * Ende des Zeitraums; die älteste Fälligkeit zuerst. Alles andere bleibt ohne Posten, eine Zahlung wird also nie geraten
 * aufgeteilt.
 */
export function vatPostenStand(posten: readonly VatPosten[], payments: readonly VatPayment[]): { posten: VatPostenStand[]; ohneBezug: VatPayment[] } {
  const stand: VatPostenStand[] = posten.map((p) => {
    const zahlungen = payments.filter((z) => z.vatReturnId === p.vatReturnId).map((z) => ({ ...z, ohneBezug: false }));
    // Lastschrift (negativ) bezahlt eine Zahllast (positiv)
    const bezahlt = -zahlungen.reduce((s, z) => s + z.amount, 0);
    return { ...p, bezahlt, verrechnet: 0, offen: p.betrag - bezahlt, zahlungen };
  });
  verrechnen(stand);
  // Nach Buchungstag, nicht in der Reihenfolge der Zuordnung: so bekommt der älteste Posten die früheste passende Zahlung
  const ohneBezug = payments.filter((z) => z.vatReturnId === null).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.id.localeCompare(b.id));
  const verwendet = new Set<string>();
  for (const p of stand) {
    if (p.zahlungen.length > 0 || p.offen === 0) continue;
    const ende = periodRange(p).end;
    const treffer = ohneBezug.find((z) => !verwendet.has(z.id) && -z.amount === p.offen && z.bookingDate >= ende);
    if (!treffer) continue;
    verwendet.add(treffer.id);
    p.zahlungen.push({ ...treffer, ohneBezug: true });
    p.bezahlt = p.offen;
    p.offen = 0;
  }
  return { posten: stand, ohneBezug: ohneBezug.filter((z) => !verwendet.has(z.id)) };
}

/**
 * Innerhalb eines Zeitraums führt die Finanzkasse ein Konto: Offenes in Gegenrichtung (Zahllast der ersten Anmeldung,
 * Minderung durch die Berichtigung) gleicht sich aus, bevor jemand zahlt oder erstattet.
 */
function verrechnen(stand: VatPostenStand[]): void {
  for (const p of stand) {
    for (const q of stand) {
      if (p.offen === 0) break;
      if (q.year !== p.year || q.month !== p.month || Math.sign(q.offen) !== -Math.sign(p.offen)) continue;
      const betrag = Math.min(Math.abs(p.offen), Math.abs(q.offen)) * Math.sign(p.offen);
      p.verrechnet += betrag;
      p.offen -= betrag;
      q.verrechnet -= betrag;
      q.offen += betrag;
    }
  }
}

/** „USt 10/2026“, für Quartale „USt Q3/2026“ */
export function vatPostenLabel({ year, month }: VatPeriod): string {
  return month >= 41 ? `USt Q${month - 40}/${year}` : `USt ${String(month).padStart(2, "0")}/${year}`;
}

const ROMAN = ["I", "II", "III", "IV"] as const;

/**
 * Nennt der Verwendungszweck den Zeitraum? Finanzkassen schreiben ihn verschieden: „USt 10/26“, „UST 10.2026“,
 * „2026/10“, „Okt. 2026“, für Quartale „Q3/26“, „3. VJ 2026“, „III/26“ oder den ELSTER-Schlüssel „43/26“. Ein Datum
 * („vom 05.10.26“) zählt nicht: Vor dem Monat darf keine Ziffer mit Trennzeichen stehen.
 */
export function purposeNamesPeriod(purpose: string, { year, month }: VatPeriod): boolean {
  const yy = String(year % 100).padStart(2, "0");
  const jahr = `(?:${year}|${yy})(?!\\d)`;
  const vor = "(?<!\\d[./-]?)(?<!\\d)";
  const sep = "\\s*[./-]\\s*";
  const sepOpt = "(?:\\s*[./-]\\s*|\\s*)";
  const patterns: string[] = [];
  if (month >= 41) {
    const q = month - 40;
    patterns.push(
      `${vor}q\\s*${q}${sepOpt}${jahr}`,
      `${vor}${q}\\s*\\.?\\s*(?:q|quartal|vj|vierteljahr)\\b\\.?${sepOpt}${jahr}`,
      `(?<![a-z])${ROMAN[q - 1]}${sep}${jahr}`,
      `${vor}${month}${sep}${jahr}`,
    );
  } else {
    const mm = `0?${month}`;
    const name = MONTHS[month - 1]!.slice(0, 3);
    patterns.push(`${vor}${mm}${sep}${jahr}`, `(?<!\\d)${year}${sep}${mm}(?!\\d)`, `\\b${name}[a-zä]*\\.?\\s*${jahr}`);
  }
  return patterns.some((p) => new RegExp(p, "i").test(purpose));
}

const addMonths = (date: string, months: number): string => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
};

/**
 * Angefangene Monate der Säumnis bei Zahlung am `zahltag` (§ 240 Abs. 1 Satz 1 AO); bis zu drei Tagen nach der
 * Fälligkeit keine (Schonfrist, § 240 Abs. 3 AO).
 */
export function saeumnisMonate(faellig: string, zahltag: string): number {
  const schonfrist = new Date(Date.parse(`${faellig}T00:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
  if (zahltag <= schonfrist) return 0;
  let monate = 1;
  while (zahltag > addMonths(faellig, monate)) monate++;
  return monate;
}

/**
 * Säumniszuschlag (§ 240 Abs. 1 Satz 1 AO): je angefangenem Monat 1 % des rückständigen Betrags, abgerundet auf den
 * nächsten durch 50 Euro teilbaren Betrag. Er ist eine steuerliche Nebenleistung (§ 3 Abs. 4 AO) und keine
 * Umsatzsteuer: gebucht wird er als Ausgabebeleg, nicht auf die Voranmeldung.
 */
export function saeumniszuschlag(rueckstand: Cents, monate: number): Cents {
  if (rueckstand <= 0 || monate <= 0) return 0;
  const abgerundet = Math.floor(rueckstand / 5_000) * 5_000;
  return (abgerundet / 100) * monate;
}
