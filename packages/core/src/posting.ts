import type { BasisPoints, Cents } from "./money.ts";
import type { InvoiceTotals, TaxRate } from "./invoice.ts";
import type { TaxTreatment } from "./treatment.ts";
import { ACCOUNTS, type Kontenrahmen, type Versteuerung } from "./kontenplan.ts";
import { paidTaxShares, type TaxShare } from "./steueranteile.ts";

export * from "./kontenplan.ts";
export * from "./steueranteile.ts";
export * from "./direktbuchung.ts";
export * from "./eroeffnungsbuchung.ts";

/**
 * Steuerschlüssel einer Buchungszeile, mit Kennzahl der Voranmeldung: USt19 (Kz 81), USt7 (86), frei,
 * RC (21), Drittland (45), Steuerfrei (48), KU (Kleinunternehmer), VSt19/VSt7 (66), keineVSt,
 * RC13bEU (46/47), RC13bDrittland (84/85), VSt13b (67), IGL (41, innergemeinschaftliche Lieferung),
 * Ausfuhr (43), IGE19/IGE7 (89/93, innergemeinschaftlicher Erwerb), VStIGE (61), EUSt (62, Einfuhrumsatzsteuer)
 */
export type TaxCode =
  | "USt19"
  | "USt7"
  | "frei"
  | "RC"
  | "Drittland"
  | "NichtSteuerbar"
  | "Steuerfrei"
  | "KU"
  | "VSt19"
  | "VSt7"
  | "keineVSt"
  | "RC13bEU"
  | "RC13bDrittland"
  | "VSt13b"
  | "IGL"
  | "Ausfuhr"
  | "IGE19"
  | "IGE7"
  | "VStIGE"
  | "EUSt";

/**
 * Steuerschuld als Leistungsempfänger (§ 13b UStG) für Belege: sonstige Leistungen eines Unternehmers
 * aus dem übrigen EU-Gebiet (Abs. 1, Kz 46/47) oder aus dem Drittland (Abs. 2 Nr. 1, Kz 84/85)
 */
export type ReverseChargeIn = "eu" | "drittland";

export const REVERSE_CHARGE_IN: Record<ReverseChargeIn, { label: string; code: "RC13bEU" | "RC13bDrittland"; kz: string; taxKz: string }> = {
  eu: { label: "Leistung eines Unternehmers aus dem EU-Ausland (§ 13b Abs. 1 UStG)", code: "RC13bEU", kz: "46", taxKz: "47" },
  drittland: { label: "Leistung eines Unternehmers aus dem Drittland (§ 13b Abs. 2 Nr. 1 UStG)", code: "RC13bDrittland", kz: "84", taxKz: "85" },
};

/**
 * Steuer, die du am Eingangsbeleg selbst schuldest: § 13b (eu, drittland) oder innergemeinschaftlicher Erwerb (§ 1a UStG).
 * Beim Erwerb entsteht die Steuer mit Ausstellung der Rechnung, spätestens mit Ablauf des Folgemonats (§ 13 Abs. 1 Nr. 6
 * UStG), auch bei Ist-Versteuerung; Haben nimmt dafür das Belegdatum.
 */
export type SelfAssessedTax = ReverseChargeIn | "ig_erwerb";

export const SELF_ASSESSED_TAX_KEYS = ["eu", "drittland", "ig_erwerb"] as const satisfies readonly SelfAssessedTax[];

export const IG_ERWERB = {
  label: "Innergemeinschaftlicher Erwerb (§ 1a UStG): Ware von einem Unternehmer aus dem EU-Ausland",
  code: { 1900: "IGE19", 700: "IGE7" },
  kz: { 1900: "89", 700: "93" },
  taxKz: "61",
} as const;

const TREATMENT_TAX_CODES = {
  reverse_charge: "RC",
  drittland: "Drittland",
  eu_sonstige: "NichtSteuerbar",
  ig_lieferung: "IGL",
  ausfuhr: "Ausfuhr",
  steuerfrei: "Steuerfrei",
  kleinunternehmer: "KU",
} as const;

export function revenueTaxCode(rate: BasisPoints, treatment: TaxTreatment = "regulaer"): TaxCode {
  if (treatment !== "regulaer") {
    if (rate !== 0) throw new RangeError(`${treatment}: Steuersatz muss 0 % sein`);
    return TREATMENT_TAX_CODES[treatment];
  }
  if (rate === 1900) return "USt19";
  if (rate === 700) return "USt7";
  if (rate === 0) return "frei";
  throw new RangeError(`Steuersatz ${rate} wird nicht unterstützt`);
}

/** Steuersatz mit eigenem Umsatzsteuer- und Vorsteuerkonto */
export function vatRate(rate: BasisPoints): Exclude<TaxRate, 0> {
  if (rate === 1900) return 1900;
  if (rate === 700) return 700;
  throw new RangeError(`Steuersatz ${rate} wird nicht unterstützt`);
}

export interface PostingLine {
  account: string;
  debit: Cents;
  credit: Cents;
  taxCode: TaxCode | null;
  /**
   * Bemessungsgrundlage zum Steuerschlüssel, wenn sie nicht der Betrag der Zeile ist, in Cent mit Vorzeichen: positiv
   * erhöht die Kennzahl, negativ (Rücklastschrift, Storno) mindert sie. Bei Ist-Versteuerung an der Zahlung: an der
   * Umbuchung der Steuer, für den Anteil zu 0 % an der Forderung, für einen Anteil ohne Steuer (gerundet 0,00 €) an einer
   * Umsatzsteuerzeile ohne Betrag (#542; DATEV: Steuerschlüssel am Zahlungseingang, Dok. 1080673)
   */
  basis?: Cents | null;
}

/** Buchungszeile: positiv auf die gewünschte Seite, negativ (Gutschrift, Storno) auf die andere */
export function side(account: string, amount: Cents, debitIfPositive: boolean, taxCode: TaxCode | null): PostingLine {
  const debit = debitIfPositive ? amount > 0 : amount < 0;
  return { account, debit: debit ? Math.abs(amount) : 0, credit: debit ? 0 : Math.abs(amount), taxCode };
}

/**
 * Buchung einer festgeschriebenen Ausgangsrechnung: Forderung an Erlöse und Umsatzsteuer.
 * Bei Ist-Versteuerung auf „Umsatzsteuer nicht fällig“; fällig wird sie mit dem Zahlungseingang.
 * Negative Summen (Storno, Korrektur) drehen die Seiten. Reverse Charge, Drittland, steuerfreie
 * und Kleinunternehmer-Umsätze gehen auf eigene Erlöskonten.
 */
export function invoicePosting(
  totals: InvoiceTotals,
  kontenrahmen: Kontenrahmen,
  versteuerung: Versteuerung,
  treatment: TaxTreatment = "regulaer",
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.forderungen, totals.gross, true, null)];
  for (const { rate, base, tax } of totals.taxes) {
    const code = revenueTaxCode(rate, treatment);
    const revenue = treatment === "regulaer" ? accounts.erloese[rate === 0 ? 0 : vatRate(rate)] : accounts.erloeseSonder[treatment];
    if (base !== 0) lines.push(side(revenue, base, false, code));
    if (tax !== 0) {
      const taxAccounts = versteuerung === "ist" ? accounts.ustNichtFaellig : accounts.ust;
      lines.push(side(taxAccounts[vatRate(rate)], tax, false, code));
    }
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

export function inputTaxCode(rate: BasisPoints): TaxCode {
  if (rate === 1900) return "VSt19";
  if (rate === 700) return "VSt7";
  if (rate === 0) return "keineVSt";
  throw new RangeError(`Steuersatz ${rate} wird nicht unterstützt`);
}

/** Wie ein Beleg bezahlt wird: offen über die Bank (Abgleich in Phase 4) oder privat ausgelegt. */
export type DocumentPayment = "bank" | "privat" | "kasse";

export { documentPosting, einfuhrumsatzsteuerIssues } from "./document-posting.ts";
/** Zeilen ohne Betrag fallen weg, außer sie tragen eine Bemessungsgrundlage (Anteil ohne Steuer bei Ist) */
const mitBetragOderBasis = (line: PostingLine) => line.debit !== 0 || line.credit !== 0 || (line.basis ?? 0) !== 0;

/** Steuerbehandlungen, deren Bemessungsgrundlage bei Ist-Versteuerung mit der Zahlung gemeldet wird (DATEV-Dok. 1080673) */
const IST_MIT_ZAHLUNG: readonly TaxTreatment[] = ["regulaer", "steuerfrei", "ausfuhr"];

/**
 * Bei Ist-Versteuerung der Teil einer Zahlung (oder Kursdifferenz) für die Voranmeldung: je Satz die Umbuchung von
 * „Umsatzsteuer nicht fällig“ auf „Umsatzsteuer“ mit der Bemessungsgrundlage an der Umsatzsteuerzeile; den Anteil zu 0 %
 * trägt die Forderungszeile mit Steuerschlüssel und Bemessungsgrundlage (#542).
 */
function istZahlungsanteil(lines: PostingLine[], shares: TaxShare[], kontenrahmen: Kontenrahmen, treatment: TaxTreatment): void {
  const accounts = ACCOUNTS[kontenrahmen];
  const meldet = IST_MIT_ZAHLUNG.includes(treatment);
  for (const { rate, base, tax } of shares) {
    if (rate === 0) {
      const forderung = lines.find((l) => l.account === accounts.forderungen);
      if (meldet && forderung && base !== 0) Object.assign(forderung, { taxCode: revenueTaxCode(0, treatment), basis: base });
      continue;
    }
    const code = revenueTaxCode(rate);
    if (tax !== 0) lines.push(side(accounts.ustNichtFaellig[vatRate(rate)], tax, true, code));
    // Gerundet ohne Steuer: eine Umsatzsteuerzeile ohne Betrag, nur mit Steuerschlüssel und Bemessungsgrundlage
    if (tax !== 0 || (meldet && base !== 0)) lines.push({ ...side(accounts.ust[vatRate(rate)], tax, false, code), ...(meldet ? { basis: base } : {}) });
  }
}

/**
 * Zahlungseingang auf eine Rechnung: Bank an Forderungen. Bei Ist-Versteuerung wird der
 * Steueranteil der Zahlung von „Umsatzsteuer nicht fällig“ auf „Umsatzsteuer“ umgebucht; die Zahlung trägt dabei die
 * Bemessungsgrundlage des bezahlten Anteils (istZahlungsanteil).
 */
export function invoicePaymentPosting(
  totals: InvoiceTotals,
  paid: Cents,
  kontenrahmen: Kontenrahmen,
  versteuerung: Versteuerung,
  shares: TaxShare[] = paidTaxShares(totals, paid),
  treatment: TaxTreatment = "regulaer",
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.bank, paid, true, null), side(accounts.forderungen, paid, false, null)];
  if (versteuerung === "ist") istZahlungsanteil(lines, shares, kontenrahmen, treatment);
  return lines.filter(mitBetragOderBasis);
}

/**
 * Bareinnahme auf eine Rechnung im Kassenbuch: wie der Zahlungseingang über die Bank, nur Kasse an Forderungen. Bei
 * Ist-Versteuerung wird die Umsatzsteuer so mit der Bareinnahme fällig (§ 13 Abs. 1 Nr. 1 Buchst. b UStG: mit Ablauf des
 * Voranmeldungszeitraums, in dem das Entgelt vereinnahmt ist). Negativ: Storno der Bareinnahme.
 */
export function invoiceCashPaymentPosting(
  totals: InvoiceTotals,
  paid: Cents,
  kontenrahmen: Kontenrahmen,
  versteuerung: Versteuerung,
  shares: TaxShare[] = paidTaxShares(totals, paid),
  treatment: TaxTreatment = "regulaer",
): PostingLine[] {
  const { bank, kasse } = ACCOUNTS[kontenrahmen];
  return invoicePaymentPosting(totals, paid, kontenrahmen, versteuerung, shares, treatment).map((l) => (l.account === bank ? { ...l, account: kasse } : l));
}

/**
 * Verrechnungskonto eines Zahlungsdienstleisters (Guthaben bei PayPal, Stripe …): SKR03 1361–1369, SKR04 1461–1469,
 * neben dem Geldtransitkonto. Nummer 1 bis 9 je Dienstleister.
 */
export function paymentProviderAccount(kontenrahmen: Kontenrahmen, index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > 9) throw new RangeError(`Verrechnungskonto ${index} gibt es nicht`);
  return `${kontenrahmen === "SKR03" ? "136" : "146"}${index}`;
}

/**
 * Ausbuchung des Rests einer Rechnung oder eines Belegs: § 17 UStG (Entgelt hat sich geändert bzw. ist uneinbringlich)
 * oder die Kursdifferenz einer Zahlung auf eine Rechnung bzw. einen Beleg in Fremdwährung (ohne Umsatzsteuer)
 */
export const WRITE_OFF_KINDS = {
  skonto: "Skonto gewährt",
  forderungsausfall: "Forderungsausfall",
  skontoErhalten: "Skonto erhalten",
  kursdifferenz: "Kursdifferenz",
} as const;

export type WriteOffKind = keyof typeof WRITE_OFF_KINDS;

/**
 * Rest einer Rechnung ausbuchen, amount mit dem Vorzeichen einer Zahlung (Rechnung positiv): Erlösschmälerung
 * bzw. Forderungsverlust und Umsatzsteuer an Forderungen, je Steuersatz anteilig wie bei einer Teilzahlung.
 * Die Umsatzsteuer mindert sich bei Soll-Versteuerung auf dem Umsatzsteuerkonto, bei Ist auf „nicht fällig“,
 * denn fällig wird dort nur, was bezahlt wird.
 */
export function invoiceWriteOffPosting(
  kind: "skonto" | "forderungsausfall",
  totals: InvoiceTotals,
  amount: Cents,
  kontenrahmen: Kontenrahmen,
  versteuerung: Versteuerung,
  treatment: TaxTreatment = "regulaer",
  shares: TaxShare[] = paidTaxShares(totals, amount),
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const expense = kind === "skonto" ? accounts.skontiGewaehrt : accounts.forderungsverluste;
  const lines: PostingLine[] = [side(accounts.forderungen, amount, false, null)];
  for (const { rate, base, tax } of shares) {
    const code = revenueTaxCode(rate, treatment);
    if (base !== 0) lines.push(side(expense, base, true, code));
    if (tax !== 0) lines.push(side((versteuerung === "ist" ? accounts.ustNichtFaellig : accounts.ust)[vatRate(rate)], tax, true, code));
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

export { documentWriteOffPosting } from "./document-write-off.ts";

/**
 * Eine Seite einer Verrechnung zweier Belege ohne Zahlung (#274, #786): Die Seite bucht ihren Anteil aus dem offenen
 * Posten aus, Verbindlichkeiten gegen das Verrechnungskonto (SKR03 1590, SKR04 1370). `amount` trägt das Vorzeichen der
 * Zeile in `document_settlements`: negativ bei der Rechnung, deren Verbindlichkeit sinkt (Soll Verbindlichkeiten), positiv
 * bei der Gutschrift, deren Soll-Saldo sinkt (Haben Verbindlichkeiten). Zusammen mit der Buchung der anderen Seite steht
 * das Verrechnungskonto auf null. Ohne Steuerzeile: Die Vorsteuer einer Gutschrift „erstattet bereits Bezahltes“ zieht
 * erst die Umbuchung beim Ausgleich um (vorsteuerAusgleichPosting). Gebucht wird je Belegseite, damit jeder Vorgang seinen
 * Beleg trägt und der DATEV-Export das Personenkonto bilden kann.
 */
export function verrechnungPosting(amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  return [side(accounts.verbindlichkeiten, -amount, true, null), side(accounts.verrechnung, amount, true, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}

/**
 * Eine Seite einer Verrechnung zwischen Ausgangsrechnung und Kundenkorrektur (#877): Die Seite bucht ihren Anteil aus dem
 * offenen Posten aus, Forderungen gegen das Verrechnungskonto (SKR03 1590, SKR04 1370). `amount` trägt das Vorzeichen der
 * Zeile in `invoice_settlements`: positiv bei der Rechnung, deren Forderung sinkt (Haben Forderungen), negativ bei der
 * Korrektur. Zusammen mit der Buchung der anderen Seite steht das Verrechnungskonto auf null. Ohne Steuerzeile: Die
 * Aufrechnung ist umsatzsteuerlich neutral, die Minderung nach § 17 Abs. 1 UStG hängt an der Korrektur selbst.
 */
export function invoiceVerrechnungPosting(amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  return [side(accounts.forderungen, amount, false, null), side(accounts.verrechnung, -amount, false, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}

/**
 * Umbuchung beim Ausgleich einer Gutschrift, die bereits Bezahltes erstattet (#786): Der Anteil, der beim Buchen auf dem
 * Zwischenkonto stand, geht auf das Vorsteuerkonto, mit Steuerschlüssel und Bemessungsgrundlage, damit Kz 66 die
 * Minderung genau dann sieht. `shares` sind die Anteile des Ausgleichs in der Richtung der Berichtigung: bei einer
 * Gutschrift positiv, also Soll Zwischenkonto / Haben Vorsteuer; eine Gegenbuchung dreht beide Seiten (reverseLines).
 * Sätze ohne Steuer (0 %) bleiben weg, sie haben nichts auf dem Zwischenkonto.
 */
export function vorsteuerAusgleichPosting(shares: readonly TaxShare[], kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [];
  for (const { rate, base, tax } of shares) {
    // Auch der Rundungsrest einer 0 %-Zeile bleibt weg: Sie hat kein eigenes Konto (vatRate lehnt 0 ab), und die
    // letzte Umbuchung zieht den Rest ohnehin nach, weil sie gegen das Journal fortschreibt
    if (rate === 0 || tax === 0) continue;
    const code = inputTaxCode(rate);
    lines.push({ ...side(accounts.vorsteuerNochNichtAbziehbar, tax, true, code), basis: base });
    lines.push(side(accounts.vorsteuer[vatRate(rate)], tax, false, code));
  }
  return lines;
}

/**
 * Kursdifferenz beim Ausgleich einer Rechnung bzw. eines Belegs in Fremdwährung: Der Rest (amount mit dem Vorzeichen einer
 * Zahlung, Rechnung positiv, Beleg negativ) wird gegen Aufwand oder Ertrag aus Kursdifferenzen ausgebucht. Die Umsatzsteuer
 * ändert sich nicht, sie bleibt beim Kurs der Rechnung. Bei Ist-Versteuerung wird die Steuer auf den ausgebuchten Teil
 * einer Rechnung trotzdem fällig, sonst bliebe sie auf „nicht fällig“ stehen.
 */
export function exchangeDifferencePosting(
  target: { kind: "invoice"; totals: InvoiceTotals; versteuerung: Versteuerung; shares?: TaxShare[]; treatment?: TaxTreatment } | { kind: "document" },
  amount: Cents,
  kontenrahmen: Kontenrahmen,
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [];
  if (target.kind === "invoice") {
    // Weniger erhalten als die Forderung in Euro: Aufwand; mehr (negativer Rest): Ertrag
    lines.push(side(accounts.forderungen, amount, false, null), side(amount > 0 ? accounts.kursAufwand : accounts.kursErtrag, amount, true, null));
    if (target.versteuerung === "ist") {
      istZahlungsanteil(lines, target.shares ?? paidTaxShares(target.totals, amount), kontenrahmen, target.treatment ?? "regulaer");
    }
    return lines.filter(mitBetragOderBasis);
  } else {
    // Rest einer Verbindlichkeit (Ausgang negativ): weniger gezahlt ist Ertrag, mehr gezahlt Aufwand
    lines.push(side(accounts.verbindlichkeiten, -amount, true, null), side(amount < 0 ? accounts.kursErtrag : accounts.kursAufwand, -amount, false, null));
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

/** Kursdifferenz als Teil eines Bankumsatzes (Zahlung über dem offenen Betrag): Bank an Ertrag bzw. Aufwand an Bank */
export function exchangeDifferenceBankPosting(amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  return [side(accounts.bank, amount, true, null), side(amount > 0 ? accounts.kursErtrag : accounts.kursAufwand, amount, false, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}

/** Zahlung eines gebuchten Belegs: Verbindlichkeiten an Bank (amount wie auf dem Konto, Ausgang negativ). */
export function documentPaymentPosting(amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  return [side(accounts.verbindlichkeiten, -amount, true, null), side(accounts.bank, amount, true, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}
