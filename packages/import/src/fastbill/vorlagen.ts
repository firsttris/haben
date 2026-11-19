import { addMonthsAnchored, type Cents, type Millis, type RecurringInterval, type ServicePeriodMode, TAX_RATES, type TaxTreatment } from "@haben/core";
import { parseImportUnit } from "../csv-import/values.ts";
import { lexToBasisPoints, lexToCents } from "../lexoffice/map.ts";
import { fbDate, fbNumber } from "./map.ts";
import type { FbRecurring } from "./types.ts";

/*
 * Wiederkehrende Rechnungen aus FastBill (recurring.get, https://apidocs.fastbill.com/fastbill/de/recurring.html) als
 * Vorlagen von Haben. Sie kommen immer pausiert an (importRecurringPaused), damit in der Übergangszeit nicht FastBill
 * und Haben dieselbe Rechnung schicken.
 *
 * Am echten Konto (November 2026): Liste INVOICES, ITEMS wie bei invoice.get, bei IS_GROSS 0 ist UNIT_PRICE netto,
 * VAT_CASE kommt als 0/1 wie bei den Rechnungen, PAYMENT_TYPE als Zahl, kein Statusfeld und kein Feld für den nächsten
 * Termin. Bei Angeboten ist UNIT_PRICE mit IS_GROSS 1 brutto; für Vorlagen gilt hier dasselbe (Preise nach IS_GROSS).
 */

export interface FbRecurringLine {
  description: string;
  detail: string;
  itemNumber: string;
  quantity: Millis;
  unit: string;
  /** Netto oder brutto nach priceMode */
  unitPrice: Cents;
  taxRate: (typeof TAX_RATES)[number];
}

export interface FbRecurringTemplate {
  name: string;
  intro: string;
  note: string;
  taxTreatment: TaxTreatment;
  priceMode: "netto" | "brutto";
  lines: FbRecurringLine[];
  intervalMonths: RecurringInterval;
  anchorDay: number;
  nextDate: string;
  endDate: string | null;
  servicePeriod: ServicePeriodMode;
}

export type FbRecurringMapped = { ok: true; template: FbRecurringTemplate; customerId: string | null; hints: string[] } | { ok: false; reason: string };

/** FREQUENCY → Monate; Wochen und zwei Monate kennt Haben nicht */
const FREQUENCIES: Record<string, RecurringInterval> = { monthly: 1, "3 months": 3, "6 months": 6, yearly: 12 };

/** Wie beim Abgleich der Belege (fastbillTaxType in auswertungen/altbestand-steuerart.ts): 1 unterscheidet Lieferung und Leistung nicht */
const VAT_CASES: Record<string, TaxTreatment> = {
  "": "regulaer",
  "0": "regulaer",
  standard: "regulaer",
  small_business_regulation: "kleinunternehmer",
  b2b_eu_services: "reverse_charge",
  b2b_eu_goods: "ig_lieferung",
  b2b_noneu_goods: "ausfuhr",
  b2c_noneu_goods: "ausfuhr",
  b2b_noneu_services: "drittland",
};

const PAYMENT_TYPES: Record<string, string> = { "2": "Lastschrift", "3": "Bar", "4": "PayPal", "5": "Vorkasse", "6": "Kreditkarte" };

const text = (value: unknown) => (value == null ? "" : String(value).trim());

const clip = (value: string, max: number, hints: string[], what: string) => {
  if (value.length <= max) return value;
  hints.push(`${what} war länger als ${max} Zeichen und ist gekürzt.`);
  return value.slice(0, max);
};

const lastDayOfMonth = (date: string) => {
  const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  return new Date(Date.UTC(y, m, 0)).getUTCDate() === Number(date.slice(8, 10));
};

const discounted = (o: { DISCOUNT_PERCENT?: unknown; DISCOUNT_AMOUNT?: unknown }) =>
  fbNumber(o.DISCOUNT_PERCENT as string) !== 0 || fbNumber(o.DISCOUNT_AMOUNT as string) !== 0;

function lines(raw: FbRecurring, hints: string[], units: readonly string[]): FbRecurringLine[] | string {
  const items = raw.ITEMS ?? [];
  if (items.length === 0) return "Die Vorlage hat keine Positionen.";
  const result: FbRecurringLine[] = [];
  for (const [i, item] of items.entries()) {
    const n = i + 1;
    const taxRate = lexToBasisPoints(fbNumber(item.VAT_PERCENT));
    if (!(TAX_RATES as readonly number[]).includes(taxRate)) return `Position ${n}: Steuersatz ${fbNumber(item.VAT_PERCENT)} % gibt es in Haben nicht.`;
    if (discounted(item)) return `Position ${n}: Rabatt, wiederkehrende Rechnungen in Haben kennen keine Rabatte.`;
    const quantity = Math.round(fbNumber(item.QUANTITY) * 1000);
    const exact = fbNumber(item.UNIT_PRICE) * 100;
    const price = lexToCents(fbNumber(item.UNIT_PRICE));
    if (Math.abs(exact - Math.round(exact)) > 1e-6)
      hints.push(`Position ${n}: Einzelpreis ${fbNumber(item.UNIT_PRICE)} hat Bruchteile von Cent, auf den Cent gerundet. Preis prüfen.`);
    if (quantity < 1) return `Position ${n}: Menge ${fbNumber(item.QUANTITY)} ist nicht übernehmbar.`;
    const unit = parseImportUnit(text(item.UNIT), units);
    if (!unit.ok) hints.push(`Position ${n}: Einheit „${text(item.UNIT)}“ kennt Haben nicht, als „Stk.“ übernommen.`);
    // Bezeichnung = erste Zeile, der Rest als Text zur Position
    const [first = "", ...rest] = text(item.DESCRIPTION).split(/\r?\n/);
    let description = first.trim();
    if (!description) {
      description = "Position";
      hints.push(`Position ${n} hat in FastBill keine Bezeichnung.`);
    }
    result.push({
      description: clip(description, 500, hints, `Bezeichnung der Position ${n}`),
      detail: clip(rest.join("\n").trim(), 2000, hints, `Text der Position ${n}`),
      itemNumber: clip(text(item.ARTICLE_NUMBER), 50, hints, `Artikelnummer der Position ${n}`),
      quantity,
      unit: unit.ok ? unit.value : "Stk.",
      unitPrice: price,
      taxRate: taxRate as (typeof TAX_RATES)[number],
    });
  }
  return result;
}

/** ok: false nennt den Grund, warum Haben die Vorlage nicht abbilden kann */
/** units: eigene Einheiten aus Haben (#748), wie beim CSV-Import */
export function mapFbRecurring(raw: FbRecurring, units: readonly string[] = []): FbRecurringMapped {
  const hints: string[] = [];
  const currency = text(raw.CURRENCY_CODE).toUpperCase() || "EUR";
  if (currency !== "EUR") return { ok: false, reason: `Währung ${currency}: Haben erzeugt wiederkehrende Rechnungen nur in Euro.` };
  const frequency = text(raw.FREQUENCY);
  const intervalMonths = FREQUENCIES[frequency];
  if (!intervalMonths)
    return { ok: false, reason: `Turnus „${frequency}“: Haben kennt nur monatlich, vierteljährlich, halbjährlich und jährlich. Bitte von Hand anlegen.` };
  const vatCase = text(raw.VAT_CASE);
  const taxTreatment = VAT_CASES[vatCase];
  if (!taxTreatment) return { ok: false, reason: `Umsatzsteuerfall „${vatCase}“ ist nicht eindeutig zuzuordnen. Bitte von Hand anlegen.` };
  if (discounted(raw)) return { ok: false, reason: "Rabatt auf die Rechnung: wiederkehrende Rechnungen in Haben kennen keine Rabatte." };
  const nextDate = fbDate(text(raw.START_DATE));
  if (!nextDate) return { ok: false, reason: "Kein Startdatum." };
  hints.push("„Nächste Rechnung am“ ist das Startdatum aus FastBill. Prüfen, wann FastBill zuletzt abgerechnet hat.");

  const result = lines(raw, hints, units);
  if (typeof result === "string") return { ok: false, reason: result };

  // Ankertag vor dem Enddatum: Am Monatsende laufen die Termine auf den Monatsletzten (addMonthsAnchored wie dueDates)
  const anchorDay = lastDayOfMonth(nextDate) ? 31 : Number(nextDate.slice(8, 10));
  const occurrences = Math.round(fbNumber(raw.OCCURENCES));
  const endDate = occurrences > 0 ? addMonthsAnchored(nextDate, intervalMonths * (occurrences - 1), anchorDay) : null;
  if (endDate) hints.push(`In FastBill auf ${occurrences} Rechnungen begrenzt; Enddatum ab dem Startdatum gerechnet. Prüfen.`);
  if (fbNumber(raw.CASH_DISCOUNT_PERCENT) !== 0)
    hints.push(`Skonto ${fbNumber(raw.CASH_DISCOUNT_PERCENT)} % in ${fbNumber(raw.CASH_DISCOUNT_DAYS)} Tagen ist nicht übernommen.`);
  const payment = PAYMENT_TYPES[text(raw.PAYMENT_TYPE)];
  if (payment) hints.push(`Zahlungsart in FastBill: ${payment}. In Haben ist sie Überweisung; bitte prüfen.`);
  if (fbDate(text(raw.SERVICE_PERIOD_START)) || fbDate(text(raw.SERVICE_PERIOD_END)) || text(raw.DELIVERY_DATE))
    hints.push("FastBill nennt einen Leistungszeitraum oder ein Lieferdatum; Haben rechnet ihn je Lauf. Bitte den Leistungszeitraum setzen.");
  if (text(raw.NOTE)) hints.push("Die Notiz aus FastBill ist nicht übernommen.");
  if (taxTreatment !== "regulaer") hints.push(`Umsatzsteuer aus FastBill „${vatCase}“ übernommen. Prüfen.`);
  // UNIT_PRICE bei IS_GROSS 1 war am echten Konto nur bei Angeboten zu sehen (brutto), nicht bei Vorlagen
  if (text(raw.IS_GROSS) === "1") hints.push("In FastBill mit Bruttopreisen angelegt. Preise mit FastBill vergleichen.");

  const name = text(raw.INVOICE_TITLE) || "Wiederkehrende Rechnung aus FastBill";
  return {
    ok: true,
    customerId: text(raw.CUSTOMER_ID) && text(raw.CUSTOMER_ID) !== "0" ? text(raw.CUSTOMER_ID) : null,
    hints,
    template: {
      name: clip(name, 200, hints, "Bezeichnung"),
      intro: clip(text(raw.INTROTEXT), 2000, hints, "Einleitung"),
      note: "",
      taxTreatment,
      priceMode: text(raw.IS_GROSS) === "1" ? "brutto" : "netto",
      lines: result,
      intervalMonths,
      anchorDay,
      nextDate,
      endDate,
      servicePeriod: "keiner",
    },
  };
}
