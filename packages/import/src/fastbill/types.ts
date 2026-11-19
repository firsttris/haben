import { z } from "zod";

/*
 * Zod-Schemas für die Antworten der FastBill-API 1.0 (https://apidocs.fastbill.com/).
 *
 * Grundsätze wie bei Lexoffice und sevDesk:
 * - Alle Objekte sind "loose": unbekannte Felder bleiben erhalten, keine Transforms, keine Defaults.
 *   Das geparste Objekt lässt sich unverändert archivieren.
 * - Die Doku zeigt nur XML; ob JSON Beträge und IDs als Text oder Zahl liefert, ist offen. Beides wird
 *   akzeptiert, umgerechnet wird erst in map.ts.
 * - Listen (ITEMS, VAT_ITEMS, PAYMENTS, COMMENTS) können fehlen, leer oder null sein.
 */

const str = z.string().nullish();
const numeric = z.union([z.string(), z.number()]).nullish();
const id = z.union([z.string(), z.number()]);
const list = <T extends z.ZodType>(item: T) => z.array(item).nullish();
/** Kategorie: im echten Konto eine leere Liste, wenn keine gesetzt ist; Text oder Objekt sind nicht ausgeschlossen. */
const category = z.union([z.string(), z.array(z.unknown()), z.looseObject({})]).nullish();

/** Fehlerliste im Antwortumschlag: Text oder { ERROR: Text } je Eintrag. */
const errorsSchema = z.union([z.array(z.union([z.string(), z.looseObject({})])), z.string(), z.looseObject({})]).nullish();

/** Umschlag jeder Antwort: { REQUEST, RESPONSE: { <LISTE>: [...], ERRORS? } } */
export const fbEnvelopeSchema = z.looseObject({
  REQUEST: z.unknown().optional(),
  RESPONSE: z.looseObject({ ERRORS: errorsSchema }),
});
export type FbEnvelope = z.infer<typeof fbEnvelopeSchema>;

// ---------------------------------------------------------------- Kunden und Kontakte

export const fbCustomerSchema = z.looseObject({
  CUSTOMER_ID: id,
  CUSTOMER_NUMBER: numeric,
  /** business | consumer */
  CUSTOMER_TYPE: str,
  ORGANIZATION: str,
  SALUTATION: str,
  FIRST_NAME: str,
  LAST_NAME: str,
  ADDRESS: str,
  ADDRESS_2: str,
  ZIPCODE: str,
  CITY: str,
  /** ISO 3166-1 alpha-2 */
  COUNTRY_CODE: str,
  EMAIL: str,
  PHONE: str,
  VAT_ID: str,
  CURRENCY_CODE: str,
  CREATED: str,
  LASTUPDATE: str,
});
export type FbCustomer = z.infer<typeof fbCustomerSchema>;

export const fbContactSchema = z.looseObject({
  CONTACT_ID: id,
  CUSTOMER_ID: id.nullish(),
  ORGANIZATION: str,
  SALUTATION: str,
  FIRST_NAME: str,
  LAST_NAME: str,
  EMAIL: str,
  PHONE: str,
});
export type FbContact = z.infer<typeof fbContactSchema>;

// ---------------------------------------------------------------- Rechnungen

/** Position einer Rechnung (ITEMS in invoice.get, sonst item.get) */
export const fbInvoiceItemSchema = z.looseObject({
  INVOICE_ITEM_ID: id.nullish(),
  ARTICLE_NUMBER: numeric,
  DESCRIPTION: str,
  QUANTITY: numeric,
  /** Einzelpreis, bei gesetztem Rabatt schon rabattiert */
  UNIT_PRICE: numeric,
  VAT_PERCENT: numeric,
  VAT_VALUE: numeric,
  COMPLETE_NET: numeric,
  COMPLETE_GROSS: numeric,
  SORT_ORDER: numeric,
  UNIT: str,
  DISCOUNT_PERCENT: numeric,
  DISCOUNT_AMOUNT: numeric,
});
export type FbInvoiceItem = z.infer<typeof fbInvoiceItemSchema>;

/** Umsatzsteuer je Satz (VAT_ITEMS) */
export const fbVatItemSchema = z.looseObject({
  VAT_PERCENT: numeric,
  COMPLETE_NET: numeric,
  VAT_VALUE: numeric,
});
export type FbVatItem = z.infer<typeof fbVatItemSchema>;

/** Zahlung zu einer Rechnung; die Doku nennt die Felder nicht, die Namen stammen aus einem echten Konto (November 2026). */
export const fbPaymentSchema = z.looseObject({
  PAYMENT_ID: id.nullish(),
  /** "19.02.2015" (TT.MM.JJJJ), nicht ISO wie die übrigen Datumsfelder */
  DATE: str,
  AMOUNT: numeric,
  CURRENCY_CODE: str,
  NOTE: str,
  /** Zahlungsweg als Text, etwa der Name des Bankkontos oder "Paypal" */
  TYPE: str,
});
export type FbPayment = z.infer<typeof fbPaymentSchema>;

export const fbInvoiceSchema = z.looseObject({
  INVOICE_ID: id,
  /** outgoing | draft | credit */
  TYPE: str,
  /** standard | progress_invoice | final_invoice */
  SUBTYPE: str,
  /** Rechnungen: draft | canceled | paid | overdue | unpaid; Gutschriften: issued | canceled */
  STATE: str,
  /** 1 = storniert */
  IS_CANCELED: numeric,
  /** Bei einem Storno die stornierte Rechnung */
  REFERENCED_INVOICE_ID: id.nullish(),
  INVOICE_NUMBER: numeric,
  INVOICE_TITLE: str,
  CUSTOMER_ID: id.nullish(),
  CUSTOMER_NUMBER: numeric,
  ORGANIZATION: str,
  FIRST_NAME: str,
  LAST_NAME: str,
  COUNTRY_CODE: str,
  VAT_ID: str,
  INVOICE_DATE: str,
  DUE_DATE: str,
  PAID_DATE: str,
  DELIVERY_DATE: str,
  SERVICE_PERIOD_START: str,
  SERVICE_PERIOD_END: str,
  CURRENCY_CODE: str,
  BASE_CURRENCY_CODE: str,
  EXCHANGE_RATE: numeric,
  /** 1 = Einzelpreise brutto */
  IS_GROSS: numeric,
  VAT_CASE: numeric,
  SUB_TOTAL: numeric,
  VAT_TOTAL: numeric,
  TOTAL: numeric,
  ITEMS: list(fbInvoiceItemSchema),
  VAT_ITEMS: list(fbVatItemSchema),
  PAYMENTS: list(fbPaymentSchema),
  /** Adresse des PDFs; ob sie ohne Anmeldung lädt, ist offen */
  DOCUMENT_URL: str,
  LASTUPDATE: str,
});
export type FbInvoice = z.infer<typeof fbInvoiceSchema>;

// ---------------------------------------------------------------- Ausgaben

export const fbExpenseSchema = z.looseObject({
  INVOICE_ID: id,
  /** Lieferant */
  ORGANIZATION: str,
  CATEGORY: category,
  INVOICE_NUMBER: numeric,
  INVOICE_DATE: str,
  DUE_DATE: str,
  PAID_DATE: str,
  SERVICE_PERIOD_START: str,
  SERVICE_PERIOD_END: str,
  CURRENCY_CODE: str,
  BASE_CURRENCY_CODE: str,
  EXCHANGE_RATE: numeric,
  SUB_TOTAL: numeric,
  VAT_TOTAL: numeric,
  TOTAL: numeric,
  NOTE: str,
  VAT_ITEMS: list(fbVatItemSchema),
  ITEMS: list(fbInvoiceItemSchema),
  CUSTOMER_ID: id.nullish(),
  /** 0/1: innergemeinschaftlicher Erwerb */
  VAT_CASE: numeric,
  DOCUMENT_URL: str,
});
export type FbExpense = z.infer<typeof fbExpenseSchema>;

// ---------------------------------------------------------------- Wiederkehrende Rechnungen

/** recurring.get (https://apidocs.fastbill.com/fastbill/de/recurring.html); Liste INVOICES im echten Konto */
export const fbRecurringSchema = z.looseObject({
  INVOICE_ID: id,
  CUSTOMER_ID: id.nullish(),
  INVOICE_TITLE: str,
  INTROTEXT: str,
  NOTE: str,
  CURRENCY_CODE: str,
  /** monthly, 3 months, 6 months, yearly, weekly, 2 weeks, 4 weeks, 2 months */
  FREQUENCY: str,
  START_DATE: str,
  /** Anzahl der Rechnungen, 0 = unbegrenzt */
  OCCURENCES: numeric,
  IS_GROSS: numeric,
  VAT_CASE: numeric,
  PAYMENT_TYPE: numeric,
  CASH_DISCOUNT_PERCENT: numeric,
  CASH_DISCOUNT_DAYS: numeric,
  DISCOUNT_PERCENT: numeric,
  DISCOUNT_AMOUNT: numeric,
  SERVICE_PERIOD_START: str,
  DELIVERY_DATE: str,
  ITEMS: list(fbInvoiceItemSchema),
});
export type FbRecurring = z.infer<typeof fbRecurringSchema>;
// ---------------------------------------------------------------- Angebote

/** estimate.get (https://apidocs.fastbill.com/fastbill/de/estimate.html); Liste ESTIMATES im echten Konto */
export const fbEstimateSchema = z.looseObject({
  ESTIMATE_ID: id,
  ESTIMATE_NUMBER: numeric,
  ESTIMATE_DATE: str,
  /** Gültig bis */
  DUE_DATE: str,
  /** created, sent, negotiation, accepted, rejected, invoiced */
  STATE: str,
  CUSTOMER_ID: id.nullish(),
  ORGANIZATION: str,
  FIRST_NAME: str,
  LAST_NAME: str,
  CURRENCY_CODE: str,
  SUB_TOTAL: numeric,
  VAT_TOTAL: numeric,
  TOTAL: numeric,
  /** Lädt das PDF ohne Anmeldung (echtes Konto, November 2026) */
  DOCUMENT_URL: str,
});
export type FbEstimate = z.infer<typeof fbEstimateSchema>;

// ---------------------------------------------------------------- Zeiten und Projekte

/** time.get (https://apidocs.fastbill.com/fastbill/de/time.html); Liste TIMES im echten Konto */
export const fbTimeSchema = z.looseObject({
  TIME_ID: id,
  CUSTOMER_ID: id.nullish(),
  PROJECT_ID: id.nullish(),
  /** Fehlt bei einer Zeit, die noch nicht abgerechnet ist (echtes Konto, November 2026) */
  INVOICE_ID: id.nullish(),
  /** JJJJ-MM-TT hh:mm:ss */
  DATE: str,
  MINUTES: numeric,
  BILLABLE_MINUTES: numeric,
  COMMENT: str,
});
export type FbTime = z.infer<typeof fbTimeSchema>;

/** project.get (https://apidocs.fastbill.com/fastbill/de/project.html); Liste PROJECTS im echten Konto */
export const fbProjectSchema = z.looseObject({
  PROJECT_ID: id,
  PROJECT_NAME: str,
  CUSTOMER_ID: id.nullish(),
  HOUR_PRICE: numeric,
  CURRENCY_CODE: str,
});
export type FbProject = z.infer<typeof fbProjectSchema>;

// ---------------------------------------------------------------- Artikel

/** article.get (https://apidocs.fastbill.com/fastbill/de/article.html) */
export const fbArticleSchema = z.looseObject({
  ARTICLE_ID: id,
  ARTICLE_NUMBER: numeric,
  TITLE: str,
  DESCRIPTION: str,
  UNIT: str,
  /** Immer netto, auch bei IS_GROSS 1 (echtes Konto, November 2026) */
  UNIT_PRICE: numeric,
  CURRENCY_CODE: str,
  VAT_PERCENT: numeric,
  /** 0/1: Preis in FastBill brutto eingegeben */
  IS_GROSS: numeric,
});
export type FbArticle = z.infer<typeof fbArticleSchema>;

/** Bytes einer Datei mit MIME-Typ und – falls bekannt – Dateiname. */
export interface FbFile {
  bytes: Uint8Array;
  mimeType: string;
  filename: string | null;
}
