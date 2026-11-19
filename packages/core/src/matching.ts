import { formatEuro, type Cents } from "./money.ts";
import type { VatPeriod } from "./period.ts";
import { formatPercent, skontoGezogen, type SkontoZahlfrist } from "./skonto.ts";
import { purposeNamesPeriod, saeumnisMonate, saeumniszuschlag } from "./ustva-posten.ts";

export interface MatchTransaction {
  bookingDate: string;
  /** Eingang positiv, Ausgang negativ */
  amount: Cents;
  counterpartyName: string;
  counterpartyIban?: string | null;
  purpose: string;
  /** Referenz der Bank; manche Exporte tragen hier die EndToEndId (DKB: Kundenreferenz) */
  bankReference?: string | null;
  /** EndToEndId der Überweisung, soweit der Auszug sie nennt (CAMT) */
  endToEndId?: string | null;
}

export interface OpenItem {
  /** ustva: Zahllast oder Erstattung einer abgegebenen Voranmeldung (id ist die Voranmeldung) */
  type: "invoice" | "document" | "ustva";
  id: string;
  /** Rechnungsnummer (eigene oder des Lieferanten) */
  number: string;
  date: string;
  dueDate?: string | null;
  /** Offener Betrag mit dem Vorzeichen, das die Zahlung auf dem Konto hätte */
  open: Cents;
  partyName: string;
  partyIbans: string[];
  /** Währung der Rechnung bzw. des Belegs; open ist immer in Euro umgerechnet */
  currency?: string;
  /** EndToEndIds der SEPA-Überweisungen, die Haben für den Beleg erzeugt hat */
  references?: string[];
  /**
   * Nur bei Rechnungen: Bestellnummern, unter denen die Zahlung beim Dienstleister erscheint (externe Referenz einer
   * Plattform wie Etsy, Bestellnummer des Kunden, eigene Auftragsnummer)
   */
  orderReferences?: string[];
  /**
   * Nur bei Rechnungen: festgeschriebene Rechnungskorrekturen zu dieser Rechnung, die selbst noch offen sind (open mit
   * dem Vorzeichen der Erstattung). Zahlt der Kunde „Rechnung minus Korrektur“, gehört der Rest dorthin, nicht in eine Ausbuchung nach § 17 Abs. 1 UStG (#1398).
   */
  openCorrections?: OffeneKorrektur[];
  /** Nur bei eigenen, noch ganz offenen Rechnungen in Euro: das angebotene Skonto je Stufe */
  skonto?: SkontoZahlfrist[];
  /**
   * Nur bei ganz offenen Rechnungen in Euro mit offenen Korrekturen: das Skonto je Stufe auf den Betrag nach allen
   * offenen Korrekturen. Das Skonto mindert das schon geminderte Entgelt, nicht den Betrag der Rechnung (#1398).
   */
  skontoNachKorrektur?: SkontoZahlfrist[];
  /** Nur bei Voranmeldungen: der Zeitraum, den die Finanzkasse im Verwendungszweck nennt */
  period?: VatPeriod;
  /**
   * Nur bei Voranmeldungen: letzter Tag der Schonfrist für den Säumniszuschlag (`schonfristEnde`, mit den Feiertagen im
   * Bundesland des Finanzamts); fehlt er, zählen nur die bundesweiten Feiertage
   */
  schonfristEnde?: string;
}

/** Offene Rechnungskorrektur an ihrer Rechnung, open mit dem Vorzeichen der Erstattung (negativ) */
export interface OffeneKorrektur {
  id: string;
  number: string;
  open: Cents;
}

/**
 * Korrekturen, die den Rest einer Zahlung auf eine Rechnung genau ausgleichen: eine einzelne mit genau diesem Betrag,
 * sonst alle offenen zusammen. Eine Suche über Teilmengen gibt es bewusst nicht; im Alltag zieht der Kunde eine
 * Korrektur ab oder alle.
 */
export function korrekturenFuerRest(corrections: readonly OffeneKorrektur[] | undefined, rest: Cents): OffeneKorrektur[] | undefined {
  if (!corrections?.length || rest <= 0) return undefined;
  const einzeln = corrections.find((k) => k.open === -rest);
  if (einzeln) return [einzeln];
  return corrections.length > 1 && corrections.reduce((sum, k) => sum + k.open, 0) === -rest ? [...corrections] : undefined;
}

/** Zahlung „Rechnung minus Korrektur“, auch mit Skonto auf den geminderten Betrag */
export interface ZahlungMitKorrektur {
  corrections: OffeneKorrektur[];
  /** Skontostufe, um die die Zahlung nach den Korrekturen noch gekürzt ist */
  stufe?: SkontoZahlfrist;
  /** Rest der Rechnung nach Zahlung und Korrekturen, als Skonto auszubuchen (0 ohne Skonto) */
  skonto: Cents;
}

/**
 * Erkennt einen Zahlungseingang „Rechnung minus Korrektur“ (#1398): Die offenen Korrekturen gleichen den Rest genau aus
 * (korrekturenFuerRest), oder nach allen offenen Korrekturen ist die Zahlung in der Frist genau um das Skonto auf den
 * geminderten Betrag gekürzt (skontoNachKorrektur). Zugeordnet wird als Aufteilung: Rechnung über ihren offenen Betrag,
 * jede Korrektur über ihren; ein Skonto bucht der Abgleich als Rest der Rechnung aus.
 */
export function zahlungMitKorrektur(tx: Pick<MatchTransaction, "amount" | "bookingDate">, item: OpenItem): ZahlungMitKorrektur | undefined {
  if (item.type !== "invoice" || tx.amount <= 0 || !item.openCorrections?.length) return undefined;
  const corrections = korrekturenFuerRest(item.openCorrections, item.open - tx.amount);
  if (corrections) return { corrections, skonto: 0 };
  const stufe = skontoGezogen(item.skontoNachKorrektur, tx.bookingDate, tx.amount);
  if (!stufe) return undefined;
  const all = [...item.openCorrections];
  return { corrections: all, stufe, skonto: item.open + all.reduce((sum, k) => sum + k.open, 0) - tx.amount };
}

/** Bis zu dieser Abweichung (in Prozent des offenen Betrags) gilt eine Zahlung auf Fremdwährung als passend */
const EXCHANGE_TOLERANCE = 0.05;

export interface Suggestion {
  item: OpenItem;
  score: number;
  reasons: string[];
  /** Betrag, der zugeordnet würde */
  amount: Cents;
  /**
   * Nur bei Fremdwährung: Zahlung minus offener Betrag, wenn die Zahlung um höchstens 5 % abweicht. Dann lässt sich
   * die Abweichung als Kursdifferenz buchen.
   */
  exchangeDifference?: Cents;
  /**
   * Zahlung in der Frist genau um das Skonto einer Stufe gekürzt: dieser Rest (offen − Zahlung), den der Abgleich mit
   * der Zahlung als gewährtes Skonto ausbucht
   */
  skonto?: Cents;
  /**
   * Zahlung „Rechnung minus Korrektur“ (zahlungMitKorrektur): diese offenen Korrekturen gehören mit zur Zahlung. Gebucht
   * wird als Aufteilung, mit skonto zusätzlich das Skonto auf den geminderten Betrag.
   */
  corrections?: OffeneKorrektur[];
}

/** Stufe, um deren Skonto die Zahlung gekürzt ist (skontoGezogen) */
function skontoTaken(tx: Pick<MatchTransaction, "amount" | "bookingDate">, item: OpenItem): SkontoZahlfrist | undefined {
  return skontoGezogen(item.skonto, tx.bookingDate, tx.amount);
}

const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const STOP_WORDS = new Set(["gmbh", "ag", "ug", "kg", "ohg", "mbh", "co", "und", "der", "die", "das", "ek", "se", "ltd", "inc"]);

function words(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-zäöüß0-9]+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

export function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * Rechnungsnummer im Verwendungszweck, unabhängig von Leerzeichen und Trennzeichen.
 * Direkt davor und danach darf keine Ziffer stehen, sonst steckte 2026-100 in 2026-1000.
 * Bei Bestellnummern gehören auch angrenzende Buchstaben zur Nummer (AU2026042 ist nicht AU2026042A).
 */
export function purposeContainsNumber(purpose: string, number: string, boundary: "digits" | "alphanumeric" = "digits"): boolean {
  const needle = compact(number);
  if (needle.length < 3) return false;
  const adjacent = boundary === "alphanumeric" ? "[a-z0-9]" : "[0-9]";
  const pattern = new RegExp(`(?<!${adjacent})${[...needle].join("[^a-z0-9]*")}(?!${adjacent})`);
  return pattern.test(purpose.toLowerCase());
}

/**
 * Referenz einer Überweisung aus Haben im Umsatz: als EndToEndId, als Referenz der Bank oder im Verwendungszweck
 * („EREF: HABEN-…“), unabhängig von Groß- und Kleinschreibung und Trennzeichen.
 */
export function transactionHasReference(tx: Pick<MatchTransaction, "purpose" | "bankReference" | "endToEndId">, reference: string): boolean {
  const needle = compact(reference);
  if (needle.length < 8) return false;
  return [tx.endToEndId, tx.bankReference, tx.purpose].some((value) => value && compact(value).includes(needle));
}

/**
 * Vorschläge für einen Bankumsatz mit Begründung: Betrag, Rechnungsnummer im Verwendungszweck,
 * bekannte IBAN, Name; bei Belegen Betrag und Datum ± 5 Tage und die Referenz einer Überweisung aus Haben.
 */
export function suggestMatches(tx: MatchTransaction, items: OpenItem[], limit = 3): Suggestion[] {
  const iban = tx.counterpartyIban?.replace(/\s/g, "").toUpperCase();
  const txWords = words(tx.counterpartyName);
  const suggestions: Suggestion[] = [];

  for (const item of items) {
    if (item.open === 0 || Math.sign(item.open) !== Math.sign(tx.amount)) continue;
    if (item.type === "ustva") {
      const vat = vatPostenSuggestion(tx, item);
      if (vat) suggestions.push(vat);
      continue;
    }
    const reasons: string[] = [];
    let score = 0;

    const exact = item.open === tx.amount;
    const foreign = item.currency !== undefined && item.currency !== "EUR";
    const nearRate = foreign && !exact && Math.abs(tx.amount - item.open) <= Math.abs(item.open) * EXCHANGE_TOLERANCE;
    const korrektur = exact ? undefined : zahlungMitKorrektur(tx, item);
    const skonto = exact || korrektur ? undefined : skontoTaken(tx, item);
    if (exact) {
      score += 50;
      reasons.push("Betrag stimmt exakt");
    } else if (korrektur) {
      score += 50;
      const nummern = korrektur.corrections.map((k) => k.number).join(", ");
      const summe = formatEuro(korrektur.corrections.reduce((sum, k) => sum + k.open, 0));
      const text = `Betrag stimmt mit ${korrektur.corrections.length === 1 ? "Korrektur" : "Korrekturen"} ${nummern} (${summe})`;
      reasons.push(korrektur.stufe ? `${text} und ${formatPercent(korrektur.stufe.percent)} Skonto (${formatEuro(korrektur.skonto)}), in der Frist` : text);
    } else if (skonto) {
      score += 50;
      reasons.push(`Betrag stimmt mit ${formatPercent(skonto.percent)} Skonto (${formatEuro(skonto.amount)}), in der Frist`);
    } else if (nearRate) {
      score += 30;
      reasons.push(`Betrag passt bis auf eine Kursdifferenz (${item.currency})`);
    } else if (Math.abs(tx.amount) < Math.abs(item.open)) {
      score += 5;
      reasons.push("Teilbetrag des offenen Betrags");
    }
    const reference = item.references?.find((r) => transactionHasReference(tx, r));
    if (reference) {
      score += 60;
      reasons.push(`Überweisung aus Haben (${reference})`);
    }
    if (purposeContainsNumber(tx.purpose, item.number)) {
      score += 40;
      reasons.push("Rechnungsnummer im Verwendungszweck");
    } else if (korrektur?.corrections.some((k) => purposeContainsNumber(tx.purpose, k.number))) {
      // „abzgl. Korrektur 2026-004“: Die Nummer der Korrektur zeigt so sicher auf die Rechnung wie ihre eigene
      score += 40;
      reasons.push("Nummer der Korrektur im Verwendungszweck");
    }
    // Zahlungsdienstleister nennen die Bestellnummer statt der Rechnungsnummer („Payment for Order #…“). Sie entscheidet,
    // wenn mehrere Rechnungen denselben Betrag haben, und zählt deshalb wie die Referenz einer Überweisung aus Haben.
    // Nur bei exaktem Betrag: Gebühren, Gebühren-Gutschriften und der Ausgleich des Guthabens nach einer Erstattung nennen
    // dieselbe Bestellnummer, gehören aber nicht zur Rechnung (Teilzahlungen gibt es bei Plattformen nicht, der Verkauf kommt in voller Höhe).
    const order = exact ? item.orderReferences?.find((r) => compact(r).length >= 5 && purposeContainsNumber(tx.purpose, r, "alphanumeric")) : undefined;
    if (order) {
      score += 60;
      reasons.push(`Bestellnummer im Verwendungszweck (${order})`);
    }
    if (iban && item.partyIbans.some((i) => i.replace(/\s/g, "").toUpperCase() === iban)) {
      score += 30;
      reasons.push(item.type === "document" ? "IBAN des Lieferanten" : "IBAN bekannt vom Kontakt");
    }
    const partyWords = words(item.partyName);
    if ([...partyWords].some((w) => txWords.has(w))) {
      score += 15;
      reasons.push("Name passt");
    }
    if (item.type === "document") {
      const near = [item.date, item.dueDate].some((d) => d && daysBetween(d, tx.bookingDate) <= 5);
      if (near) {
        score += 10;
        reasons.push("Datum passt (± 5 Tage)");
      }
    }
    // Ohne passenden Betrag nur mit starkem weiteren Hinweis vorschlagen
    if (score < 40) continue;
    const amount = Math.abs(tx.amount) <= Math.abs(item.open) ? tx.amount : item.open;
    suggestions.push({
      item,
      score,
      reasons,
      amount,
      ...(nearRate ? { exchangeDifference: tx.amount - item.open } : {}),
      ...(skonto ? { skonto: item.open - tx.amount } : {}),
      ...(korrektur ? { corrections: korrektur.corrections, ...(korrektur.skonto ? { skonto: korrektur.skonto } : {}) } : {}),
    });
  }

  return suggestions.sort((a, b) => b.score - a.score || a.item.date.localeCompare(b.item.date)).slice(0, limit);
}

/**
 * Voranmeldung als offener Posten: nur bei einer Zahlung des bzw. an das Finanzamt oder mit Umsatzsteuer im
 * Verwendungszweck, nie bei einer anderen Steuer oder der Sondervorauszahlung. Punkte wie bei Rechnungen: Betrag 50,
 * Zeitraum im Verwendungszweck 40 (statt der Rechnungsnummer), Finanzamt als Gegenpartei 15. Übersteigt die Lastschrift
 * die Zahllast genau um einen Säumniszuschlag (§ 240 AO), wird nur die Zahllast zugeordnet; der Rest bleibt für den Beleg.
 */
function vatPostenSuggestion(tx: MatchTransaction, item: OpenItem): Suggestion | null {
  const finanzamt = TAX_OFFICE.test(tx.counterpartyName);
  if (!finanzamt && !VAT_PURPOSE.test(tx.purpose)) return null;
  if (OTHER_TAX_PURPOSE.test(tx.purpose) || SVZ_PURPOSE.test(tx.purpose)) return null;
  const reasons: string[] = [];
  let score = 0;
  if (item.open === tx.amount) {
    score += 50;
    reasons.push("Betrag stimmt exakt");
  } else if (Math.abs(tx.amount) < Math.abs(item.open)) {
    score += 5;
    reasons.push("Teilbetrag des offenen Betrags");
  } else if (tx.amount < 0 && item.dueDate) {
    const monate = saeumnisMonate(item.dueDate, tx.bookingDate, item.schonfristEnde);
    const zuschlag = saeumniszuschlag(-item.open, monate);
    if (zuschlag > 0 && -tx.amount === -item.open + zuschlag) {
      score += 40;
      reasons.push(`Zahllast und ${formatEuro(zuschlag)} Säumniszuschlag (§ 240 AO, ${monate} ${monate === 1 ? "Monat" : "Monate"})`);
    }
  }
  if (item.period && purposeNamesPeriod(tx.purpose, item.period)) {
    score += 40;
    reasons.push("Zeitraum im Verwendungszweck");
  }
  if (finanzamt) {
    score += 15;
    reasons.push("Finanzamt als Gegenpartei");
  }
  if (score < 40) return null;
  const amount = Math.abs(tx.amount) <= Math.abs(item.open) ? tx.amount : item.open;
  return { item, score, reasons, amount };
}

/** Finanzkassen und Steuerverwaltung, wie sie im Namen der Gegenpartei stehen */
export const TAX_OFFICE = /finanzamt|finanzkasse|steuerverwaltung|landeshauptkasse|landesfinanzkasse|bundeskasse|staatsoberkasse|finanzbehörde/i;
/** Umsatzsteuer im Verwendungszweck: „USt 09/2026“, „Umsatzsteuer“, „UStVA“ */
export const VAT_PURPOSE = /umsatzsteuer|\bust\b|\bust[- ]?va\b|\bust\d|voranmeldung/i;
/** Andere Steuern, die dasselbe Finanzamt einzieht oder erstattet (oft privat) */
/** Sondervorauszahlung der Dauerfristverlängerung (§ 47 UStDV): „USt-Sondervorauszahlung“, „USt-SVZ“, „USt 1/11“ */
export const SVZ_PURPOSE = /sondervorauszahlung|\bsvz\b|\b1\/11\b/i;
export const OTHER_TAX_PURPOSE = /einkommen|\best\b|\best[- ]?v|kirchen|\bkist\b|soli|gewerbe|\bgewst\b|kfz|grundsteuer|lohnsteuer|\blst\b/i;

export * from "./matching-direkt.ts";
