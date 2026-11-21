import { aufladungFehler, kategorieFehler, type KategorieAngabe } from "./direkt-kategorie.ts";
import { daysBetween, OTHER_TAX_PURPOSE, SVZ_PURPOSE, TAX_OFFICE, VAT_PURPOSE, type MatchTransaction } from "./matching.ts";
import type { Cents } from "./money.ts";

/* Vorschläge für Buchungen ohne Rechnung, Auszahlungen, Umbuchungen und gelernte Buchungen (matching.ts ordnet offene Posten zu) */

/** Wofür ein Bankkonto dient; steuert Vorschläge für Buchungen ohne Rechnung */
export const ACCOUNT_PURPOSES = {
  geschaeft: "Geschäftskonto",
  steuer: "Steuerkonto (Lastschrift und Erstattungen des Finanzamts)",
  ruecklage: "Rücklagen- oder Sparkonto",
  privat: "Privatkonto (Geschäftsvorfälle gegen Entnahme, Einlage oder Gesellschafter)",
} as const;

/** Zahlungsdienstleister mit eigenem Guthaben (Verrechnungskonto); pattern erkennt sie als Gegenpartei auf der Bank */
export const PAYMENT_PROVIDERS = {
  paypal: { label: "PayPal", pattern: /paypal/i },
  stripe: { label: "Stripe", pattern: /stripe/i },
  shopify: { label: "Shopify Payments", pattern: /shopify/i },
  etsy: { label: "Etsy Payments", pattern: /etsy/i },
  ebay: { label: "eBay", pattern: /ebay/i },
  sumup: { label: "SumUp", pattern: /sum ?up/i },
  // Auszahlender laut Auszahlungsbeleg: Google Payment Ireland Ltd bzw. Apple Distribution International Ltd. Für Apple an
  // echten Kontoauszügen bestätigt („APPLE DISTRIBUTION INTL LTD“, #1628); den Absender „Apple Inc“ erkennt
  // stores/payout.ts am Verwendungszweck. Google noch zu bestätigen.
  googleplay: { label: "Google Play", pattern: /google\s*(payment|commerce|ireland)/i },
  appstore: { label: "App Store", pattern: /apple\s*distribution|itunes/i },
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
  kind:
    | "privat"
    | "spende"
    | "geldtransit"
    | "ustVorauszahlung"
    | "sondervorauszahlung"
    | "gebuehren"
    | "mahnerloes"
    | "lohnsteuer"
    | "zinsertrag"
    | "kategorie"
    | "aufladung";
  reasons: string[];
  /** Nur bei „kategorie“ und „aufladung“: Kategorie und Steuersatz, wie früher gebucht (#324, #1356) */
  kategorie?: KategorieAngabe;
  /**
   * Nur mit Gegenbuchung vorschlagen: Gegenpartei „PayPal“ auf der Bank kann auch ein mit PayPal bezahlter Einkauf sein;
   * Geldtransit ist es erst, wenn im Konto des Dienstleisters die passende Auszahlung steht.
   */
  requiresCounterpart?: boolean;
  /** Bei Geldtransit: das eigene Konto auf der Gegenseite */
  counterAccountId?: string;
}

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
    // Auf dem Privatkonto selbst ist der Übertrag kein Geschäftsvorfall; die Entnahme bucht das andere Konto (#873)
    if (account.purpose === "privat") return null;
    if (own.purpose === "privat") return { kind: "privat", reasons: [`Gegenkonto ist dein Privatkonto ${own.name}`] };
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
const LEARNED_KINDS = new Set(["privat", "spende", "gebuehren", "mahnerloes", "zinsertrag", "kategorie", "aufladung"]);

/** „2026-09-30“ → „30.09.2026“; `last` kann ein Zeitstempel sein, gezählt wird der Tag */
const tagText = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

/**
 * Buchungsart ohne Rechnung aus früheren Zuordnungen derselben Gegenpartei (gleiche Gegen-IBAN, sonst gleicher Name) in
 * derselben Richtung: Abbuchungen lernen nur aus Abbuchungen, Eingänge nur aus Eingängen (die Gebühr von Stripe ist keine
 * Vorlage für dessen Auszahlung). `history` zählt je Art die früheren Umsätze, bei „Direkt buchen“ auf eine Kategorie je
 * Kategorie und Steuersatz; `total` zählt die Umsätze insgesamt (ein aufgeteilter Umsatz zählt bei jeder seiner Arten,
 * aber nur einmal insgesamt). Vorgeschlagen wird nur, wenn die häufigste Art mindestens zweimal vorkam und mehr als die
 * Hälfte der Umsätze ausmacht. Eine Kategorie nur, wenn sie heute noch so direkt buchbar wäre (kategorieFehler): Nach dem
 * Wechsel zum Kleinunternehmer etwa sind Erlöse mit 19 % kein Vorschlag mehr. Eine Aufladung eines Guthabens wird wie
 * eine Kategorie mit ihrer Ausgabekategorie gelernt (#1356); ob die Rechtsform sie anbietet, prüft der Aufrufer
 * (aufRechtsformAngeboten).
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
  // Eine Aufladung nur mit der Kategorie, in der sie gebucht wurde: immer eine Ausgabe und ohne Steuersatz (#1356)
  if (top.value.kind === "aufladung" && (!kategorie || aufladungFehler(kategorie))) return null;
  const from = basis === "iban" ? "mit dieser Gegen-IBAN" : "von dieser Gegenpartei";
  return {
    kind: top.value.kind as DirectSuggestion["kind"],
    ...(kategorie ? { kategorie } : {}),
    reasons: [`${top.count} von ${top.total} Umsätzen ${from} so gebucht, zuletzt am ${tagText(top.last)}`],
  };
}
