import { roundHalfAwayFromZero, splitPrivateShare, type BasisPoints, type Cents } from "./money.ts";
import type { InvoiceTotals, TaxRate } from "./invoice.ts";
import type { TaxTreatment } from "./treatment.ts";

export type Kontenrahmen = "SKR03" | "SKR04";
export type Versteuerung = "ist" | "soll";

/** Konten, die Haben bisher bebucht. Vor dem Echtbetrieb mit dem Steuerberater abgleichen. */
export const ACCOUNTS = {
  SKR03: {
    forderungen: "1400",
    bank: "1200",
    kasse: "1000",
    erloese: { 1900: "8400", 700: "8300", 0: "8200" },
    erloeseSonder: { reverse_charge: "8336", drittland: "8338", steuerfrei: "8100", kleinunternehmer: "8195" },
    ust: { 1900: "1776", 700: "1771" },
    ustNichtFaellig: { 1900: "1766", 700: "1761" },
    vorsteuer: { 1900: "1576", 700: "1571" },
    /** § 13b: selbst geschuldete Umsatzsteuer und die Vorsteuer daraus */
    ustRc: "1787",
    vorsteuerRc: "1577",
    verbindlichkeiten: "1600",
    privateinlagen: "1890",
    privatentnahmen: "1800",
    geldtransit: "1360",
    ustVorauszahlung: "1780",
    nebenkostenGeldverkehr: "4970",
    saldenvortrag: "9000",
    /** Bezahlte Mahngebühren, Pauschalen und Verzugszinsen: kein Entgelt für eine Leistung, deshalb ohne Umsatzsteuer */
    mahnerloes: "2650",
    /** Ausbuchungen (§ 17 UStG): gewährte und erhaltene Skonti, Forderungsverluste */
    skontiGewaehrt: "8730",
    skontiErhalten: "3730",
    forderungsverluste: "2400",
    /** Kursdifferenzen bei Fremdwährung: ohne Umsatzsteuer, die bleibt beim Kurs der Rechnung (§ 16 Abs. 6 UStG) */
    kursAufwand: "2150",
    kursErtrag: "2660",
  },
  SKR04: {
    forderungen: "1200",
    bank: "1800",
    kasse: "1600",
    erloese: { 1900: "4400", 700: "4300", 0: "4200" },
    erloeseSonder: { reverse_charge: "4336", drittland: "4338", steuerfrei: "4100", kleinunternehmer: "4185" },
    ust: { 1900: "3806", 700: "3801" },
    ustNichtFaellig: { 1900: "3816", 700: "3811" },
    vorsteuer: { 1900: "1406", 700: "1401" },
    ustRc: "3837",
    vorsteuerRc: "1407",
    verbindlichkeiten: "3300",
    privateinlagen: "2180",
    privatentnahmen: "2100",
    geldtransit: "1460",
    ustVorauszahlung: "3820",
    nebenkostenGeldverkehr: "6855",
    saldenvortrag: "9000",
    mahnerloes: "7100",
    skontiGewaehrt: "4730",
    skontiErhalten: "5730",
    forderungsverluste: "6930",
    kursAufwand: "6880",
    kursErtrag: "4840",
  },
} as const;

/**
 * Ausgabenkategorien für Belege mit Aufwandskonto je Kontenrahmen.
 * Vor dem Echtbetrieb mit dem Steuerberater abgleichen.
 */
export const EXPENSE_CATEGORIES = {
  software: { label: "Software und Lizenzen", SKR03: "4964", SKR04: "6837" },
  edv: { label: "Hosting und IT-Dienste", SKR03: "4806", SKR04: "6495" },
  hardware: { label: "Hardware (GWG bis 800 € netto)", SKR03: "0480", SKR04: "0670" },
  telefon: { label: "Telefon", SKR03: "4920", SKR04: "6805" },
  internet: { label: "Internet", SKR03: "4925", SKR04: "6810" },
  buero: { label: "Bürobedarf", SKR03: "4930", SKR04: "6815" },
  literatur: { label: "Fachliteratur", SKR03: "4940", SKR04: "6820" },
  fortbildung: { label: "Fortbildung", SKR03: "4945", SKR04: "6821" },
  fahrtkosten: { label: "Reisekosten: Fahrten", SKR03: "4673", SKR04: "6673" },
  uebernachtung: { label: "Reisekosten: Übernachtung", SKR03: "4676", SKR04: "6680" },
  porto: { label: "Porto", SKR03: "4910", SKR04: "6800" },
  werbung: { label: "Werbung", SKR03: "4600", SKR04: "6600" },
  // Bewirtung: 70 % Betriebsausgabe, die Vorsteuer voll (§ 4 Abs. 5 Nr. 2 EStG); die Aufteilung macht die EÜR
  bewirtung: { label: "Bewirtung von Geschäftspartnern (70 % abziehbar)", SKR03: "4650", SKR04: "6640" },
  geschenke: { label: "Geschenke an Geschäftspartner (bis 50 € je Empfänger und Jahr)", SKR03: "4630", SKR04: "6610" },
  beratung: { label: "Rechts- und Beratungskosten", SKR03: "4950", SKR04: "6825" },
  buchfuehrung: { label: "Buchführung und Steuerberatung", SKR03: "4955", SKR04: "6830" },
  fremdleistung: { label: "Fremdleistungen", SKR03: "3100", SKR04: "5900" },
  geldverkehr: { label: "Kontoführung und Gebühren", SKR03: "4970", SKR04: "6855" },
  kfzBetrieb: { label: "Kfz: Laden, Tanken, Wartung", SKR03: "4530", SKR04: "6530" },
  kfzVersicherung: { label: "Kfz: Versicherung", SKR03: "4520", SKR04: "6520" },
  kfzSteuer: { label: "Kfz: Steuer", SKR03: "4510", SKR04: "7685" },
  kfzReparatur: { label: "Kfz: Reparaturen", SKR03: "4540", SKR04: "6540" },
  kfzLeasing: { label: "Kfz: Leasing", SKR03: "4570", SKR04: "6560" },
  versicherung: { label: "Versicherungen", SKR03: "4360", SKR04: "6400" },
  beitraege: { label: "Beiträge", SKR03: "4380", SKR04: "6420" },
  sonstiges: { label: "Sonstiger Aufwand", SKR03: "4900", SKR04: "6300" },
  // Kein Aufwand: gebucht wird auf das Anlagekonto der Anlage, abgeschrieben über das Anlagenverzeichnis
  anlage: { label: "Anlagegut (wird abgeschrieben)", SKR03: "0490", SKR04: "0690" },
} as const;

export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

export const EXPENSE_CATEGORY_KEYS = Object.keys(EXPENSE_CATEGORIES) as [ExpenseCategory, ...ExpenseCategory[]];

export const ACCOUNT_NAMES: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: {
    "1000": "Kasse",
    "1200": "Bank",
    ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`136${i}`, "Verrechnungskonto Zahlungsdienstleister"])),
    "1400": "Forderungen aus Lieferungen und Leistungen",
    "1761": "Umsatzsteuer nicht fällig 7 %",
    "1766": "Umsatzsteuer nicht fällig 19 %",
    "1771": "Umsatzsteuer 7 %",
    "1776": "Umsatzsteuer 19 %",
    "1787": "Umsatzsteuer nach § 13b UStG",
    "2150": "Aufwendungen aus Kursdifferenzen",
    "2400": "Forderungsverluste (übliche Höhe)",
    "2650": "Sonstige Zinsen und ähnliche Erträge (Verzugszinsen, Mahngebühren)",
    "2660": "Erträge aus Kursdifferenzen",
    "3730": "Erhaltene Skonti",
    "8730": "Gewährte Skonti",
    "8100": "Steuerfreie Umsätze § 4 Nr. 8 ff. UStG",
    "8195": "Erlöse als Kleinunternehmer § 19 UStG",
    "8200": "Erlöse",
    "8300": "Erlöse 7 % USt",
    "8336": "Erlöse aus im anderen EU-Land steuerpflichtigen sonstigen Leistungen (Reverse Charge)",
    "8338": "Erlöse aus im Drittland steuerbaren Leistungen",
    "8400": "Erlöse 19 % USt",
    "9000": "Saldenvorträge Sachkonten",
  },
  SKR04: {
    "1200": "Forderungen aus Lieferungen und Leistungen",
    "1600": "Kasse",
    "1800": "Bank",
    ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`146${i}`, "Verrechnungskonto Zahlungsdienstleister"])),
    "3801": "Umsatzsteuer 7 %",
    "3806": "Umsatzsteuer 19 %",
    "3837": "Umsatzsteuer nach § 13b UStG",
    "3811": "Umsatzsteuer nicht fällig 7 %",
    "3816": "Umsatzsteuer nicht fällig 19 %",
    "4100": "Steuerfreie Umsätze § 4 Nr. 8 ff. UStG",
    "4185": "Erlöse als Kleinunternehmer § 19 UStG",
    "4200": "Erlöse",
    "4300": "Erlöse 7 % USt",
    "4336": "Erlöse aus im anderen EU-Land steuerpflichtigen sonstigen Leistungen (Reverse Charge)",
    "4338": "Erlöse aus im Drittland steuerbaren Leistungen",
    "4400": "Erlöse 19 % USt",
    "4730": "Gewährte Skonti",
    "4840": "Erträge aus Kursdifferenzen",
    "5730": "Erhaltene Skonti",
    "6880": "Aufwendungen aus Kursdifferenzen",
    "6930": "Forderungsverluste (übliche Höhe)",
    "7100": "Sonstige Zinsen und ähnliche Erträge (Verzugszinsen, Mahngebühren)",
    "9000": "Saldenvorträge Sachkonten",
  },
};

/**
 * Steuerschlüssel einer Buchungszeile, mit Kennzahl der Voranmeldung: USt19 (Kz 81), USt7 (86), frei,
 * RC (21), Drittland (45), Steuerfrei (48), KU (Kleinunternehmer), VSt19/VSt7 (66), keineVSt,
 * RC13bEU (46/47), RC13bDrittland (84/85), VSt13b (67)
 */
export type TaxCode =
  | "USt19" | "USt7" | "frei" | "RC" | "Drittland" | "Steuerfrei" | "KU"
  | "VSt19" | "VSt7" | "keineVSt" | "RC13bEU" | "RC13bDrittland" | "VSt13b";

/**
 * Steuerschuld als Leistungsempfänger (§ 13b UStG) für Belege: sonstige Leistungen eines Unternehmers
 * aus dem übrigen EU-Gebiet (Abs. 1, Kz 46/47) oder aus dem Drittland (Abs. 2 Nr. 1, Kz 84/85)
 */
export type ReverseChargeIn = "eu" | "drittland";

export const REVERSE_CHARGE_IN: Record<ReverseChargeIn, { label: string; code: "RC13bEU" | "RC13bDrittland"; kz: string; taxKz: string }> = {
  eu: { label: "Leistung eines Unternehmers aus dem EU-Ausland (§ 13b Abs. 1 UStG)", code: "RC13bEU", kz: "46", taxKz: "47" },
  drittland: { label: "Leistung eines Unternehmers aus dem Drittland (§ 13b Abs. 2 Nr. 1 UStG)", code: "RC13bDrittland", kz: "84", taxKz: "85" },
};

const TREATMENT_TAX_CODES = { reverse_charge: "RC", drittland: "Drittland", steuerfrei: "Steuerfrei", kleinunternehmer: "KU" } as const;

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
function vatRate(rate: BasisPoints): Exclude<TaxRate, 0> {
  if (rate !== 1900 && rate !== 700) throw new RangeError(`Steuersatz ${rate} wird nicht unterstützt`);
  return rate;
}

export interface PostingLine {
  account: string;
  debit: Cents;
  credit: Cents;
  taxCode: TaxCode | null;
}

function side(account: string, amount: Cents, debitIfPositive: boolean, taxCode: TaxCode | null): PostingLine {
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

/**
 * Buchung eines Belegs: Aufwand und Vorsteuer an Verbindlichkeiten
 * (oder Privateinlage, wenn privat bezahlt). Gutschriften (negativ) drehen die Seiten.
 * Ohne Vorsteuerabzug (Kleinunternehmer) ist die Steuer Teil des Aufwands.
 */
export function documentPosting(
  totals: InvoiceTotals,
  category: ExpenseCategory,
  kontenrahmen: Kontenrahmen,
  payment: DocumentPayment,
  vorsteuerAbzug = true,
  /** Abweichendes Konto statt des Kategoriekontos, z. B. das Anlagekonto einer Anlage */
  account?: string,
  /** Privatanteil in Prozent, z. B. beim Handyvertrag: nur der betriebliche Teil ist Aufwand und Vorsteuer */
  privateShare = 0,
  /**
   * § 13b: Die Steuer in totals schuldest du selbst, gezahlt wird nur netto (totals.gross = Netto).
   * Gebucht wird die Steuer als Umsatzsteuer und, mit Vorsteuerabzug, im selben Betrag als Vorsteuer.
   */
  reverseCharge: ReverseChargeIn | null = null,
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const expense = account ?? EXPENSE_CATEGORIES[category][kontenrahmen];
  const lines: PostingLine[] = [];
  let privatePart = 0;
  for (const row of totals.taxes) {
    const baseSplit = splitPrivateShare(row.base, privateShare);
    const taxSplit = splitPrivateShare(row.tax, privateShare);
    privatePart += baseSplit.private + taxSplit.private;
    const { rate } = row;
    const base = baseSplit.business;
    const tax = taxSplit.business;
    if (reverseCharge) {
      if (rate === 0) throw new RangeError("§ 13b: Steuersatz muss 19 % oder 7 % sein");
      const code = REVERSE_CHARGE_IN[reverseCharge].code;
      if (!vorsteuerAbzug) {
        if (base + tax !== 0) lines.push(side(expense, base + tax, true, code));
      } else {
        if (base !== 0) lines.push(side(expense, base, true, code));
        if (tax !== 0) lines.push(side(accounts.vorsteuerRc, tax, true, "VSt13b"));
      }
      if (row.tax !== 0) lines.push(side(accounts.ustRc, row.tax, false, code));
      continue;
    }
    if (!vorsteuerAbzug) {
      if (base + tax !== 0) lines.push(side(expense, base + tax, true, "keineVSt"));
      continue;
    }
    const code = inputTaxCode(rate);
    if (base !== 0) lines.push(side(expense, base, true, code));
    if (tax !== 0) lines.push(side(accounts.vorsteuer[vatRate(rate)], tax, true, code));
  }
  // Der private Teil ist eine Entnahme; privat bezahlt heben sich Einlage und Entnahme insoweit auf
  if (privatePart !== 0) lines.push(side(accounts.privatentnahmen, privatePart, true, null));
  const counter = payment === "privat" ? accounts.privateinlagen : payment === "kasse" ? accounts.kasse : accounts.verbindlichkeiten;
  lines.push(side(counter, totals.gross, false, null));
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

/** Netto und Steuer je Satz, die auf eine Zahlung oder Ausbuchung entfallen */
export interface TaxShare {
  rate: BasisPoints;
  base: Cents;
  tax: Cents;
}

/**
 * Anteil der Steuer je Satz, der auf eine (Teil-)Zahlung entfällt. Rundung so verteilt,
 * dass die Summe dem gerundeten Gesamtanteil entspricht.
 */
export function paidTaxShares(totals: InvoiceTotals, paid: Cents): TaxShare[] {
  if (totals.gross === 0) return [];
  const share = (value: Cents) => roundHalfAwayFromZero((value * paid) / totals.gross);
  const totalTax = share(totals.tax);
  const totalNet = paid - totalTax;
  const rows = totals.taxes.map((t) => ({ rate: t.rate, base: share(t.base), tax: share(t.tax) }));
  // Rundungsrest dem größten Posten zuschlagen
  const largest = rows.reduce((best, row, i) => (Math.abs(row.base) > Math.abs(rows[best]!.base) ? i : best), 0);
  if (rows[largest]) {
    rows[largest]!.tax += totalTax - rows.reduce((s, r) => s + r.tax, 0);
    rows[largest]!.base += totalNet - rows.reduce((s, r) => s + r.base, 0);
  }
  return rows;
}

/**
 * Anteil einer weiteren Zahlung bzw. Ausbuchung auf eine Rechnung: der Anteil am dann Erledigten abzüglich dessen, was
 * die bisherigen schon erfasst haben. Einzeln gerundet ergäben 3 × 39,67 € auf 119 € nur 18,99 € Steuer; so ergeben alle
 * zusammen genau die Steuer der Rechnung, auch nach einer aufgehobenen Zahlung dazwischen.
 */
export function settlementTaxShares(totals: InvoiceTotals, settledBefore: Cents, recordedBefore: TaxShare[], amount: Cents): TaxShare[] {
  return paidTaxShares(totals, settledBefore + amount).map((target) => {
    const recorded = recordedBefore.filter((r) => r.rate === target.rate);
    return {
      rate: target.rate,
      base: target.base - recorded.reduce((sum, r) => sum + r.base, 0),
      tax: target.tax - recorded.reduce((sum, r) => sum + r.tax, 0),
    };
  });
}

/**
 * Gespeicherter Anteil einer Zahlung bzw. Ausbuchung, wenn er zur Rechnung passt: dieselben Steuersätze und zusammen der
 * Betrag; sonst aus dem Betrag gerechnet (ältere Zeilen ohne Anteil, wie gebucht). Für welche Rechnung er gerechnet ist,
 * prüft der Aufrufer (tax_shares_invoice_id), damit der Abgleich eine umgehängte Zahlung weiter als Abweichung meldet.
 */
export function recordedTaxShares(totals: InvoiceTotals, amount: Cents, stored: TaxShare[] | null | undefined): TaxShare[] {
  const computed = paidTaxShares(totals, amount);
  if (!stored) return computed;
  const fits =
    stored.length === computed.length &&
    computed.every((c) => stored.some((s) => s.rate === c.rate)) &&
    stored.reduce((sum, s) => sum + s.base + s.tax, 0) === amount;
  return fits ? stored : computed;
}

/**
 * Zahlungseingang auf eine Rechnung: Bank an Forderungen. Bei Ist-Versteuerung wird der
 * Steueranteil der Zahlung von „Umsatzsteuer nicht fällig“ auf „Umsatzsteuer“ umgebucht.
 */
export function invoicePaymentPosting(
  totals: InvoiceTotals,
  paid: Cents,
  kontenrahmen: Kontenrahmen,
  versteuerung: Versteuerung,
  shares: TaxShare[] = paidTaxShares(totals, paid),
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.bank, paid, true, null), side(accounts.forderungen, paid, false, null)];
  if (versteuerung === "ist") {
    for (const { rate, tax } of shares) {
      if (tax === 0 || rate === 0) continue;
      const code = revenueTaxCode(rate);
      lines.push(side(accounts.ustNichtFaellig[vatRate(rate)], tax, true, code));
      lines.push(side(accounts.ust[vatRate(rate)], tax, false, code));
    }
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
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

/**
 * Erhaltenes Skonto auf einen Beleg, amount mit dem Vorzeichen einer Zahlung (Ausgang negativ):
 * Verbindlichkeiten an erhaltene Skonti und Vorsteuer, anteilig je Steuersatz. Ohne Vorsteuerabzug
 * (Kleinunternehmer) mindert das Skonto den Aufwand in voller Höhe.
 */
export function documentWriteOffPosting(totals: InvoiceTotals, amount: Cents, kontenrahmen: Kontenrahmen, vorsteuerAbzug: boolean): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.verbindlichkeiten, -amount, true, null)];
  for (const { rate, base, tax } of paidTaxShares(totals, -amount)) {
    if (!vorsteuerAbzug || rate === 0) {
      if (base + tax !== 0) lines.push(side(accounts.skontiErhalten, base + tax, false, vorsteuerAbzug ? inputTaxCode(rate) : "keineVSt"));
      continue;
    }
    const code = inputTaxCode(rate);
    if (base !== 0) lines.push(side(accounts.skontiErhalten, base, false, code));
    if (tax !== 0) lines.push(side(accounts.vorsteuer[vatRate(rate)], tax, false, code));
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

/**
 * Kursdifferenz beim Ausgleich einer Rechnung bzw. eines Belegs in Fremdwährung: Der Rest (amount mit dem Vorzeichen einer
 * Zahlung, Rechnung positiv, Beleg negativ) wird gegen Aufwand oder Ertrag aus Kursdifferenzen ausgebucht. Die Umsatzsteuer
 * ändert sich nicht, sie bleibt beim Kurs der Rechnung. Bei Ist-Versteuerung wird die Steuer auf den ausgebuchten Teil
 * einer Rechnung trotzdem fällig, sonst bliebe sie auf „nicht fällig“ stehen.
 */
export function exchangeDifferencePosting(
  target: { kind: "invoice"; totals: InvoiceTotals; versteuerung: Versteuerung; shares?: TaxShare[] } | { kind: "document" },
  amount: Cents,
  kontenrahmen: Kontenrahmen,
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [];
  if (target.kind === "invoice") {
    // Weniger erhalten als die Forderung in Euro: Aufwand; mehr (negativer Rest): Ertrag
    lines.push(side(accounts.forderungen, amount, false, null), side(amount > 0 ? accounts.kursAufwand : accounts.kursErtrag, amount, true, null));
    if (target.versteuerung === "ist") {
      for (const { rate, tax } of target.shares ?? paidTaxShares(target.totals, amount)) {
        if (tax === 0 || rate === 0) continue;
        const code = revenueTaxCode(rate);
        lines.push(side(accounts.ustNichtFaellig[vatRate(rate)], tax, true, code), side(accounts.ust[vatRate(rate)], tax, false, code));
      }
    }
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

/** Bankumsätze ohne Rechnung oder Beleg */
export const DIRECT_BOOKINGS = {
  privat: "Privat (Entnahme oder Einlage)",
  geldtransit: "Geldtransit (eigenes Konto)",
  ustVorauszahlung: "Umsatzsteuer an das Finanzamt",
  gebuehren: "Kontoführung und Bankgebühren",
  mahnerloes: "Mahngebühren und Verzugszinsen (vom Kunden)",
} as const;

export type DirectBooking = keyof typeof DIRECT_BOOKINGS;

export function directPosting(kind: DirectBooking, amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const counter =
    kind === "privat"
      ? amount < 0
        ? accounts.privatentnahmen
        : accounts.privateinlagen
      : kind === "geldtransit"
        ? accounts.geldtransit
        : kind === "ustVorauszahlung"
          ? accounts.ustVorauszahlung
          : kind === "mahnerloes"
            ? accounts.mahnerloes
            : accounts.nebenkostenGeldverkehr;
  return [side(accounts.bank, amount, true, null), side(counter, amount, false, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}

/** Kassenbuchungen ohne Beleg: Einlage und Entnahme, Geld von der Bank in die Kasse und zurück */
export const CASH_BOOKINGS = {
  einlage: { label: "Einlage", sign: 1, kind: "privat" },
  entnahme: { label: "Entnahme", sign: -1, kind: "privat" },
  abhebung: { label: "Abhebung von der Bank", sign: 1, kind: "geldtransit" },
  einzahlung: { label: "Einzahlung auf die Bank", sign: -1, kind: "geldtransit" },
} as const;

export type CashBooking = keyof typeof CASH_BOOKINGS;

/** Kasse an Privateinlage bzw. Geldtransit; Ausgänge aus der Kasse (negativ) drehen die Seiten */
export function cashPosting(kind: "privat" | "geldtransit", amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const counter = kind === "geldtransit" ? accounts.geldtransit : amount < 0 ? accounts.privatentnahmen : accounts.privateinlagen;
  return [side(accounts.kasse, amount, true, null), side(counter, amount, false, null)].filter((line) => line.debit !== 0 || line.credit !== 0);
}

/**
 * Eröffnungsbuchung für eine offene Rechnung aus der Vorgänger-Buchhaltung: Forderung an Saldenvortrag.
 * Die Erlöse stehen schon in den alten Büchern. Bei Ist-Versteuerung ist die Umsatzsteuer dort noch
 * nicht angemeldet; sie kommt auf „Umsatzsteuer nicht fällig“ und wird mit dem Zahlungseingang fällig.
 */
export function openingInvoicePosting(totals: InvoiceTotals, kontenrahmen: Kontenrahmen, versteuerung: Versteuerung): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.forderungen, totals.gross, true, null)];
  if (versteuerung === "ist") {
    for (const { rate, tax } of totals.taxes) {
      if (tax !== 0) lines.push(side(accounts.ustNichtFaellig[vatRate(rate)], tax, false, null));
    }
    lines.push(side(accounts.saldenvortrag, totals.net, false, null));
  } else {
    lines.push(side(accounts.saldenvortrag, totals.gross, false, null));
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

/** Eröffnungsbuchung für einen offenen Eingangsbeleg: Saldenvortrag an Verbindlichkeiten. Vorsteuer ist schon angemeldet. */
export function openingDocumentPosting(gross: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  return [side(accounts.saldenvortrag, gross, true, null), side(accounts.verbindlichkeiten, gross, false, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}

/**
 * Storno oder Korrektur einer aus der Vorgänger-Buchhaltung übernommenen Rechnung (negative Summen).
 * Die Erlöse stehen in den alten Büchern, deshalb geht der Nettobetrag wie bei der Eröffnung gegen den
 * Saldenvortrag. Bei Soll mindert die Korrektur die dort schon angemeldete Umsatzsteuer, bei Ist die
 * noch nicht fällige.
 */
export function legacyCorrectionPosting(totals: InvoiceTotals, kontenrahmen: Kontenrahmen, versteuerung: Versteuerung): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.forderungen, totals.gross, true, null)];
  for (const { rate, tax } of totals.taxes) {
    if (tax === 0) continue;
    if (versteuerung === "ist") lines.push(side(accounts.ustNichtFaellig[vatRate(rate)], tax, false, null));
    else lines.push(side(accounts.ust[vatRate(rate)], tax, false, revenueTaxCode(rate)));
  }
  lines.push(side(accounts.saldenvortrag, totals.net, false, null));
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}
