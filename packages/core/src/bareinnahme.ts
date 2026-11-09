import type { InvoiceTotals } from "./invoice.ts";
import { taxIncluded, type BasisPoints, type Cents } from "./money.ts";
import { ACCOUNTS, side, type Kontenrahmen, type PostingLine } from "./posting.ts";

/*
 * Bareinnahme ohne Rechnung im Kassenbuch (#276), auch als Tagessumme, etwa Barverkäufe auf dem Markt an Privatkunden.
 *
 * - An Privatkunden besteht keine Rechnungspflicht (§ 14 Abs. 2 Satz 1 Nr. 2 UStG); die Umsatzsteuer entsteht trotzdem mit
 *   der Leistung (§ 13 Abs. 1 Nr. 1 UStG). Haben bucht sie am Tag der Bareinnahme, bei Ist- wie bei Soll-Versteuerung,
 *   wie „Direkt buchen“ im Bankabgleich (direkt-kategorie.ts): Ohne Rechnung kennt Haben keinen anderen Zeitpunkt, und
 *   beim Barverkauf fallen Leistung und Zahlung zusammen.
 * - Regulär mit 19 % oder 7 % (§ 12 Abs. 1 und 2 UStG): Kasse an Erlöse und fällige Umsatzsteuer, Kz 81 bzw. 86.
 * - Kleinunternehmer (§ 19 UStG): ohne Umsatzsteuer auf das Erlöskonto für Kleinunternehmer.
 * - Steuerfrei: nur Umsätze nach § 4 Nr. 8 bis 29 UStG ohne Vorsteuerabzug (etwa Heilbehandlung, Unterricht), Kz 48 wie
 *   bei einer Rechnung mit der Behandlung „steuerfrei“. Innergemeinschaftliche Lieferungen und Ausfuhren (§ 4 Nr. 1 UStG)
 *   brauchen Rechnung und Nachweise und bleiben bei den Rechnungen.
 */

export const BAREINNAHME_BEHANDLUNGEN = {
  regulaer: "Regulär besteuert (19 % oder 7 %)",
  kleinunternehmer: "Kleinunternehmer (§ 19 UStG)",
  steuerfrei: "Steuerfrei nach § 4 Nr. 8 bis 29 UStG",
} as const;

export type BareinnahmeBehandlung = keyof typeof BAREINNAHME_BEHANDLUNGEN;

export const BAREINNAHME_BEHANDLUNG_KEYS = Object.keys(BAREINNAHME_BEHANDLUNGEN) as [BareinnahmeBehandlung, ...BareinnahmeBehandlung[]];

/** Behandlung und Steuersatz einer Bareinnahme; gespeichert an der Zeile im Kassenbuch (tax_treatment, tax_rate) */
export interface BareinnahmeAngabe {
  behandlung: BareinnahmeBehandlung;
  /** Basispunkte: 1900 oder 700 bei „regulaer“, sonst 0 */
  steuersatz: BasisPoints;
}

const SAETZE = [1900, 700] as const;

/** Was die Bareinnahme verhindert; null = buchbar. kleinunternehmer: Stand am Tag der Bareinnahme */
export function bareinnahmeFehler(angabe: BareinnahmeAngabe, kleinunternehmer: boolean): string | null {
  if (angabe.behandlung !== "regulaer") {
    if (angabe.steuersatz !== 0) return "Kleinunternehmer und steuerfreie Umsätze buchst du ohne Steuer (0 %).";
    if (angabe.behandlung === "kleinunternehmer" && !kleinunternehmer) {
      return "Am Tag der Bareinnahme bist du nicht Kleinunternehmer; bitte regulär besteuert oder steuerfrei buchen.";
    }
    return null;
  }
  if (kleinunternehmer) return "Als Kleinunternehmer weist du keine Umsatzsteuer aus (§ 19 UStG); bitte „Kleinunternehmer“ wählen.";
  if (!(SAETZE as readonly number[]).includes(angabe.steuersatz)) return "Der Steuersatz muss 19 % oder 7 % sein.";
  return null;
}

/** Netto und Steuer im Betrag (Vorzeichen wie in der Kasse) */
export function bareinnahmeAnteil(angabe: BareinnahmeAngabe, amount: Cents): { base: Cents; tax: Cents } {
  const tax = angabe.behandlung === "regulaer" ? taxIncluded(amount, angabe.steuersatz) : 0;
  return { base: amount - tax, tax };
}

/** Summen wie bei einer Rechnung mit einem Steuersatz: für EÜR und Voranmeldung, die mit Rechnungssummen rechnen */
export function bareinnahmeTotals(angabe: BareinnahmeAngabe, amount: Cents): InvoiceTotals {
  const { base, tax } = bareinnahmeAnteil(angabe, amount);
  return { net: base, tax, gross: amount, taxes: [{ rate: angabe.steuersatz, base, tax }] };
}

/**
 * Buchung: Kasse an Erlöse und fällige Umsatzsteuer (kein „nicht fällig“, auch bei Ist), an das Erlöskonto für
 * Kleinunternehmer oder für steuerfreie Umsätze. Ein Storno (negativ) dreht die Seiten. Prüft den Kleinunternehmer-Stand
 * nicht; das macht der Aufrufer mit bareinnahmeFehler.
 */
export function bareinnahmePosting(angabe: BareinnahmeAngabe, amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const fehler = bareinnahmeFehler(angabe, angabe.behandlung === "kleinunternehmer");
  if (fehler) throw new RangeError(fehler);
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.kasse, amount, true, null)];
  if (angabe.behandlung === "kleinunternehmer") {
    lines.push(side(accounts.erloeseSonder.kleinunternehmer, amount, false, "KU"));
  } else if (angabe.behandlung === "steuerfrei") {
    lines.push(side(accounts.erloeseSonder.steuerfrei, amount, false, "Steuerfrei"));
  } else {
    const rate = angabe.steuersatz as (typeof SAETZE)[number];
    const { base, tax } = bareinnahmeAnteil(angabe, amount);
    const code = rate === 1900 ? "USt19" : "USt7";
    lines.push(side(accounts.erloese[rate], base, false, code), side(accounts.ust[rate], tax, false, code));
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

/** Kurz für Kassenbuch und Buchungstext: „19 %“, „Kleinunternehmer (§ 19 UStG)“, „steuerfrei (§ 4 Nr. 8 bis 29 UStG)“ */
export function bareinnahmeText(angabe: BareinnahmeAngabe): string {
  if (angabe.behandlung === "kleinunternehmer") return "Kleinunternehmer (§ 19 UStG)";
  if (angabe.behandlung === "steuerfrei") return "steuerfrei (§ 4 Nr. 8 bis 29 UStG)";
  return `${angabe.steuersatz / 100} %`;
}
