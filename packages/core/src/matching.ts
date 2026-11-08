import { kategorieFehler, type KategorieAngabe } from "./direkt-kategorie.ts";
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
  /** Nur bei eigenen, noch ganz offenen Rechnungen in Euro: das angebotene Skonto je Stufe */
  skonto?: SkontoZahlfrist[];
  /** Nur bei Voranmeldungen: der Zeitraum, den die Finanzkasse im Verwendungszweck nennt */
  period?: VatPeriod;
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

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * Rechnungsnummer im Verwendungszweck, unabhängig von Leerzeichen und Trennzeichen.
 * Direkt davor und danach darf keine Ziffer stehen, sonst steckte 2026-100 in 2026-1000.
 */
export function purposeContainsNumber(purpose: string, number: string): boolean {
  const needle = compact(number);
  if (needle.length < 3) return false;
  const pattern = new RegExp(`(?<![0-9])${[...needle].join("[^a-z0-9]*")}(?![0-9])`);
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
    const skonto = exact ? undefined : skontoTaken(tx, item);
    if (exact) {
      score += 50;
      reasons.push("Betrag stimmt exakt");
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
    const monate = saeumnisMonate(item.dueDate, tx.bookingDate);
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

/** Wofür ein Bankkonto dient; steuert Vorschläge für Buchungen ohne Rechnung */
export const ACCOUNT_PURPOSES = {
  geschaeft: "Geschäftskonto",
  steuer: "Steuerkonto (Lastschrift und Erstattungen des Finanzamts)",
  ruecklage: "Rücklagen- oder Sparkonto",
  privat: "Privatkonto (nur zur Zuordnung von Überweisungen)",
} as const;

/** Zahlungsdienstleister mit eigenem Guthaben (Verrechnungskonto); pattern erkennt sie als Gegenpartei auf der Bank */
export const PAYMENT_PROVIDERS = {
  paypal: { label: "PayPal", pattern: /paypal/i },
  stripe: { label: "Stripe", pattern: /stripe/i },
  shopify: { label: "Shopify Payments", pattern: /shopify/i },
  etsy: { label: "Etsy Payments", pattern: /etsy/i },
  ebay: { label: "eBay", pattern: /ebay/i },
  sumup: { label: "SumUp", pattern: /sum ?up/i },
  sonstige: { label: "Anderer Zahlungsdienstleister", pattern: null },
} as const;

export type PaymentProvider = keyof typeof PAYMENT_PROVIDERS;

/** Zweck eines Bankkontos; Zahlungsdienstleister legt Haben nur über „Zahlungsdienstleister hinzufügen“ an */
export type AccountPurpose = keyof typeof ACCOUNT_PURPOSES | "zahlungsdienstleister";

export interface OwnAccount {
  id: string;
  name: string;
  /** Leer bei Zahlungsdienstleistern */
  iban: string | null;
  purpose: AccountPurpose;
  provider?: PaymentProvider | null;
}

/** Auszahlung vom Guthaben des Dienstleisters auf ein Bankkonto, wie sie im Export steht */
const PAYOUT_PURPOSE = /auszahlung|abbuchung|payout|withdrawal|transfer to bank|überweisung auf (dein|ihr) bank/i;

/** Muster, an dem die Gegenpartei auf der Bank den Dienstleister erkennt; null bei „sonstige“ */
export function providerPattern(account: Pick<OwnAccount, "provider">): RegExp | null {
  return account.provider ? PAYMENT_PROVIDERS[account.provider].pattern : null;
}

export interface DirectSuggestion {
  kind: "privat" | "geldtransit" | "ustVorauszahlung" | "sondervorauszahlung" | "gebuehren" | "mahnerloes" | "lohnsteuer" | "zinsertrag" | "kategorie";
  reasons: string[];
  /** Nur bei „kategorie“: Kategorie und Steuersatz, wie früher direkt gebucht (#324) */
  kategorie?: KategorieAngabe;
  /**
   * Nur mit Gegenbuchung vorschlagen: Gegenpartei „PayPal“ auf der Bank kann auch ein mit PayPal bezahlter Einkauf sein;
   * Geldtransit ist es erst, wenn im Konto des Dienstleisters die passende Auszahlung steht.
   */
  requiresCounterpart?: boolean;
  /** Bei Geldtransit: das eigene Konto auf der Gegenseite */
  counterAccountId?: string;
}

/** Finanzkassen und Steuerverwaltung, wie sie im Namen der Gegenpartei stehen */
export const TAX_OFFICE = /finanzamt|finanzkasse|steuerverwaltung|landeshauptkasse|landesfinanzkasse|bundeskasse|staatsoberkasse|finanzbehörde/i;
/** Umsatzsteuer im Verwendungszweck: „USt 09/2026“, „Umsatzsteuer“, „UStVA“ */
export const VAT_PURPOSE = /umsatzsteuer|\bust\b|\bust[- ]?va\b|\bust\d|voranmeldung/i;
/** Andere Steuern, die dasselbe Finanzamt einzieht oder erstattet (oft privat) */
/** Sondervorauszahlung der Dauerfristverlängerung (§ 47 UStDV): „USt-Sondervorauszahlung“, „USt-SVZ“, „USt 1/11“ */
const SVZ_PURPOSE = /sondervorauszahlung|\bsvz\b|\b1\/11\b/i;
export const OTHER_TAX_PURPOSE = /einkommen|\best\b|\best[- ]?v|kirchen|\bkist\b|soli|gewerbe|\bgewst\b|kfz|grundsteuer|lohnsteuer|\blst\b/i;

/**
 * Vorschlag für einen Umsatz ohne Rechnung aus dem Zweck der Konten:
 * - Gegenkonto ist ein eigenes Konto: Geldtransit, bei einem Privatkonto Privatentnahme bzw. -einlage
 * - Steuerkonto und Gegenpartei ist das Finanzamt: Umsatzsteuer-Zahlung bzw. Erstattung
 */
export function suggestDirectBooking(tx: MatchTransaction, account: OwnAccount, ownAccounts: OwnAccount[]): DirectSuggestion | null {
  // Zahlungsdienstleister: Auszahlung auf die Bank ist Geldtransit; das Bankkonto findet die Gegenbuchung
  if (account.purpose === "zahlungsdienstleister") {
    if (tx.amount < 0 && PAYOUT_PURPOSE.test(`${tx.purpose} ${tx.counterpartyName}`)) {
      return { kind: "geldtransit", reasons: [`Auszahlung von ${account.name} auf ein eigenes Bankkonto`] };
    }
    return null;
  }
  // Auf der Bank: Gegenpartei ist ein eigener Zahlungsdienstleister (Auszahlung von PayPal, Aufladung)
  const provider = ownAccounts.find((a) => a.purpose === "zahlungsdienstleister" && providerPattern(a)?.test(tx.counterpartyName));
  if (provider) {
    return {
      kind: "geldtransit",
      reasons: [`Gegenpartei ist dein Zahlungsdienstleister ${provider.name}`],
      counterAccountId: provider.id,
      requiresCounterpart: true,
    };
  }
  const iban = tx.counterpartyIban?.replace(/\s/g, "").toUpperCase();
  const own = iban ? ownAccounts.find((a) => a.id !== account.id && a.iban === iban) : undefined;
  if (own) {
    if (own.purpose === "privat" || account.purpose === "privat") {
      return { kind: "privat", reasons: [`Gegenkonto ist dein Privatkonto ${own.purpose === "privat" ? own.name : account.name}`] };
    }
    return { kind: "geldtransit", reasons: [`Gegenkonto ist dein Konto ${own.name}`], counterAccountId: own.id };
  }
  // Nur bei erkennbarer Umsatzsteuer: auf dem Steuerkonto liegt oft auch die Rücklage für die Einkommensteuer
  if (account.purpose === "steuer" && TAX_OFFICE.test(tx.counterpartyName) && VAT_PURPOSE.test(tx.purpose) && !OTHER_TAX_PURPOSE.test(tx.purpose)) {
    // Die Sondervorauszahlung gehört auf ihr eigenes Konto (SKR03 1781, SKR04 3830), nicht auf die laufende Vorauszahlung
    if (SVZ_PURPOSE.test(tx.purpose)) {
      return { kind: "sondervorauszahlung", reasons: ["Sondervorauszahlung (Dauerfristverlängerung) an das Finanzamt"] };
    }
    return {
      kind: "ustVorauszahlung",
      reasons: [tx.amount < 0 ? "Lastschrift des Finanzamts auf dem Steuerkonto" : "Erstattung des Finanzamts auf das Steuerkonto"],
    };
  }
  return null;
}

/**
 * Lastschrift des Finanzamts über genau den Gesamtbetrag (Kz 83) einer übermittelten Lohnsteuer-Anmeldung: die Lohnsteuer
 * dieses Zeitraums. Nur bei eindeutigem Betrag; zwei Zeiträume mit demselben Betrag lassen offen, welcher gezahlt ist.
 */
export function suggestLohnsteuer(
  tx: Pick<MatchTransaction, "amount" | "counterpartyName">,
  anmeldungen: readonly { label: string; betrag: Cents }[],
): DirectSuggestion | null {
  if (tx.amount >= 0 || !TAX_OFFICE.test(tx.counterpartyName)) return null;
  const passend = anmeldungen.filter((a) => a.betrag === -tx.amount);
  if (passend.length !== 1) return null;
  return { kind: "lohnsteuer", reasons: [`Gesamtbetrag (Kz 83) der Lohnsteuer-Anmeldung ${passend[0]!.label}`] };
}

/** Auszahlungs-ID aus der Referenz einer Teilauszahlung („payout-98765|…“, Shopify Payments) */
export function payoutKey(bankReference: string | null | undefined): string | null {
  return /^payout-([^|]+)\|/.exec(bankReference ?? "")?.[1] ?? null;
}

/**
 * Teile einer Auszahlung im Konto des Dienstleisters, die zusammen einem Eingang auf der Bank entsprechen: alle mit
 * derselben Auszahlungs-ID, noch ganz offen, höchstens fünf Tage vom Eingang entfernt, Summe gleich dem Eingang.
 */
export function findPayoutGroup<T extends { id: string; bookingDate: string; amount: Cents; open: Cents; bankReference?: string | null }>(
  tx: { bookingDate: string; amount: Cents },
  candidates: T[],
): T[] | null {
  const groups = new Map<string, T[]>();
  for (const c of candidates) {
    const key = payoutKey(c.bankReference);
    if (key) groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const fitting = [...groups.values()].filter(
    (rows) =>
      rows.every((r) => r.open === r.amount && daysBetween(r.bookingDate, tx.bookingDate) <= 5) && rows.reduce((s, r) => s + r.amount, 0) === -tx.amount,
  );
  return fitting.length === 1 ? fitting[0]! : null;
}

const normalizeIban = (iban: string | null | undefined) => iban?.replace(/\s/g, "").toUpperCase() ?? null;

/**
 * Gegenbuchung eines Geldtransits auf dem anderen eigenen Konto: gleicher Betrag mit umgekehrtem Vorzeichen,
 * noch ganz offen, höchstens fünf Tage auseinander, und als Gegenkonto das Ausgangskonto. Ohne Gegen-IBAN (manche
 * Banken liefern sie bei eigenen Überträgen nicht) nur, wenn es keinen Treffer mit IBAN gibt; sonst die zeitlich nächste.
 * Eine fremde Zahlung über denselben Betrag (Erstattung, Kunde) zählt nicht.
 */
export function findTransferCounterpart<
  T extends { id: string; bookingDate: string; amount: Cents; open: Cents; counterpartyIban?: string | null; counterpartyName?: string },
>(
  tx: { bookingDate: string; amount: Cents },
  /** IBAN des Ausgangskontos; bei einem Zahlungsdienstleister leer, dann erkennt pattern dessen Namen auf der Bank */
  sourceIban: string | null,
  candidates: T[],
  pattern: RegExp | null = null,
): T | null {
  const source = normalizeIban(sourceIban);
  const fitting = candidates.filter((c) => c.amount === -tx.amount && c.open === c.amount && daysBetween(c.bookingDate, tx.bookingDate) <= 5);
  const byDate = (a: T, b: T) => daysBetween(a.bookingDate, tx.bookingDate) - daysBetween(b.bookingDate, tx.bookingDate);
  const withIban = fitting
    .filter((c) => (source !== null && normalizeIban(c.counterpartyIban) === source) || pattern?.test(c.counterpartyName ?? ""))
    .sort(byDate);
  const withoutIban = fitting.filter((c) => !c.counterpartyIban).sort(byDate);
  return withIban[0] ?? withoutIban[0] ?? null;
}

/**
 * Häufigster Wert mit Anzahl und letzter Verwendung, bei Gleichstand der zuletzt verwendete. Für Vorschläge aus früheren
 * Buchungen: die Kategorie eines Lieferanten, die Buchungsart einer Gegenpartei. `last` ist ein sortierbarer Zeitstempel (ISO).
 */
export function mostFrequent<T>(
  rows: { value: T; count: number; last: string }[],
  /** Zahl der Fälle, wenn ein Fall mehrere Werte haben kann (aufgeteilter Umsatz); sonst die Summe der Anzahlen */
  total = rows.reduce((s, r) => s + r.count, 0),
): { value: T; count: number; total: number; last: string } | null {
  const best = [...rows].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))[0];
  return best ? { value: best.value, count: best.count, total, last: best.last } : null;
}

/**
 * Eine frühere Zuordnung, wie sie die Historie zählt: die Art (invoice, document, privat, gebuehren, kategorie …), bei
 * „kategorie“ mit Kategorie und Steuersatz, damit jede Kategorie und jeder Satz für sich zählt.
 */
export interface LearnedBooking {
  kind: string;
  kategorie?: KategorieAngabe;
}

/**
 * Arten ohne Rechnung, die Haben aus früheren Buchungen vorschlägt. Nicht dabei: was die Regeln der Kontozwecke besser
 * wissen oder was eine Angabe braucht, die sich je Zahlung ändert (Steuerart und Jahr, Teil einer Darlehensrate, die
 * offene Lohnverbindlichkeit).
 */
const LEARNED_KINDS = new Set(["privat", "gebuehren", "mahnerloes", "zinsertrag", "kategorie"]);

/** „2026-09-30“ → „30.09.2026“; `last` kann ein Zeitstempel sein, gezählt wird der Tag */
const tagText = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

/**
 * Buchungsart ohne Rechnung aus früheren Zuordnungen derselben Gegenpartei (gleiche Gegen-IBAN, sonst gleicher Name) in
 * derselben Richtung: Abbuchungen lernen nur aus Abbuchungen, Eingänge nur aus Eingängen (die Gebühr von Stripe ist keine
 * Vorlage für dessen Auszahlung). `history` zählt je Art die früheren Umsätze, bei „Direkt buchen“ auf eine Kategorie je
 * Kategorie und Steuersatz; `total` zählt die Umsätze insgesamt (ein aufgeteilter Umsatz zählt bei jeder seiner Arten,
 * aber nur einmal insgesamt). Vorgeschlagen wird nur, wenn die häufigste Art mindestens zweimal vorkam und mehr als die
 * Hälfte der Umsätze ausmacht. Eine Kategorie nur, wenn sie heute noch so direkt buchbar wäre (kategorieFehler): Nach dem
 * Wechsel zum Kleinunternehmer etwa sind Erlöse mit 19 % kein Vorschlag mehr.
 * Nicht gelernt werden:
 * - Geldtransit: braucht die Gegenbuchung, die die Regeln zu eigenen Konten finden
 * - Umsatzsteuer und alles mit dem Finanzamt: über dieselbe IBAN laufen Umsatzsteuer und private Steuern
 * - Lohn, Sozialversicherung, Steuerzahlungen und Darlehen: Abrechnung, Steuerart oder Teil der Rate ändern sich je Zahlung
 */
export function learnedDirectBooking(
  tx: Pick<MatchTransaction, "counterpartyName">,
  history: { value: LearnedBooking; count: number; last: string }[],
  total: number,
  basis: "iban" | "name",
  /** Kleinunternehmer heute; entscheidet, ob eine gelernte Erlöskategorie mit oder ohne Steuer noch buchbar ist */
  kleinunternehmer = false,
): DirectSuggestion | null {
  if (TAX_OFFICE.test(tx.counterpartyName)) return null;
  const top = mostFrequent(history, total);
  if (!top || !LEARNED_KINDS.has(top.value.kind) || top.count < 2 || top.count * 2 <= top.total) return null;
  const { kategorie } = top.value;
  if (top.value.kind === "kategorie" && (!kategorie || kategorieFehler(kategorie, kleinunternehmer))) return null;
  const from = basis === "iban" ? "mit dieser Gegen-IBAN" : "von dieser Gegenpartei";
  return {
    kind: top.value.kind as DirectSuggestion["kind"],
    ...(kategorie ? { kategorie } : {}),
    reasons: [`${top.count} von ${top.total} Umsätzen ${from} so gebucht, zuletzt am ${tagText(top.last)}`],
  };
}
