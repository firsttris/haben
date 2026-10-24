import type { Cents } from "./money.ts";

export interface MatchTransaction {
  bookingDate: string;
  /** Eingang positiv, Ausgang negativ */
  amount: Cents;
  counterpartyName: string;
  counterpartyIban?: string | null;
  purpose: string;
}

export interface OpenItem {
  type: "invoice" | "document";
  id: string;
  /** Rechnungsnummer (eigene oder des Lieferanten) */
  number: string;
  date: string;
  dueDate?: string | null;
  /** Offener Betrag mit dem Vorzeichen, das die Zahlung auf dem Konto hätte */
  open: Cents;
  partyName: string;
  partyIbans: string[];
}

export interface Suggestion {
  item: OpenItem;
  score: number;
  reasons: string[];
  /** Betrag, der zugeordnet würde */
  amount: Cents;
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

/** Rechnungsnummer im Verwendungszweck, unabhängig von Leerzeichen und Trennzeichen */
export function purposeContainsNumber(purpose: string, number: string): boolean {
  const needle = compact(number);
  return needle.length >= 3 && compact(purpose).includes(needle);
}

/**
 * Vorschläge für einen Bankumsatz mit Begründung: Betrag, Rechnungsnummer im Verwendungszweck,
 * bekannte IBAN, Name; bei Belegen Betrag und Datum ± 5 Tage.
 */
export function suggestMatches(tx: MatchTransaction, items: OpenItem[], limit = 3): Suggestion[] {
  const iban = tx.counterpartyIban?.replace(/\s/g, "").toUpperCase();
  const txWords = words(tx.counterpartyName);
  const suggestions: Suggestion[] = [];

  for (const item of items) {
    if (item.open === 0 || Math.sign(item.open) !== Math.sign(tx.amount)) continue;
    const reasons: string[] = [];
    let score = 0;

    const exact = item.open === tx.amount;
    if (exact) {
      score += 50;
      reasons.push("Betrag stimmt exakt");
    } else if (Math.abs(tx.amount) < Math.abs(item.open)) {
      score += 5;
      reasons.push("Teilbetrag des offenen Betrags");
    }
    if (purposeContainsNumber(tx.purpose, item.number)) {
      score += 40;
      reasons.push("Rechnungsnummer im Verwendungszweck");
    }
    if (iban && item.partyIbans.some((i) => i.replace(/\s/g, "").toUpperCase() === iban)) {
      score += 30;
      reasons.push("IBAN bekannt vom Kontakt");
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
    suggestions.push({ item, score, reasons, amount });
  }

  return suggestions.sort((a, b) => b.score - a.score || a.item.date.localeCompare(b.item.date)).slice(0, limit);
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
  kind: "privat" | "geldtransit" | "ustVorauszahlung";
  reasons: string[];
  /**
   * Nur mit Gegenbuchung vorschlagen: Gegenpartei „PayPal“ auf der Bank kann auch ein mit PayPal bezahlter Einkauf sein;
   * Geldtransit ist es erst, wenn im Konto des Dienstleisters die passende Auszahlung steht.
   */
  requiresCounterpart?: boolean;
  /** Bei Geldtransit: das eigene Konto auf der Gegenseite */
  counterAccountId?: string;
}

/** Finanzkassen und Steuerverwaltung, wie sie im Namen der Gegenpartei stehen */
const TAX_OFFICE = /finanzamt|finanzkasse|steuerverwaltung|landeshauptkasse|landesfinanzkasse|bundeskasse|staatsoberkasse|finanzbehörde/i;
/** Umsatzsteuer im Verwendungszweck: „USt 09/2026“, „Umsatzsteuer“, „UStVA“ */
const VAT_PURPOSE = /umsatzsteuer|\bust\b|\bust[- ]?va\b|\bust\d|voranmeldung/i;
/** Andere Steuern, die dasselbe Finanzamt einzieht oder erstattet (oft privat) */
const OTHER_TAX_PURPOSE = /einkommen|\best\b|\best[- ]?v|kirchen|\bkist\b|soli|gewerbe|\bgewst\b|kfz|grundsteuer|lohnsteuer|\blst\b/i;

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
    return { kind: "geldtransit", reasons: [`Gegenpartei ist dein Zahlungsdienstleister ${provider.name}`], counterAccountId: provider.id, requiresCounterpart: true };
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
    return {
      kind: "ustVorauszahlung",
      reasons: [tx.amount < 0 ? "Lastschrift des Finanzamts auf dem Steuerkonto" : "Erstattung des Finanzamts auf das Steuerkonto"],
    };
  }
  return null;
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
    .filter((c) => (source !== null && normalizeIban(c.counterpartyIban) === source) || (pattern !== null && pattern.test(c.counterpartyName ?? "")))
    .sort(byDate);
  const withoutIban = fitting.filter((c) => !c.counterpartyIban).sort(byDate);
  return withIban[0] ?? withoutIban[0] ?? null;
}
