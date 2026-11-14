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
});
export type FbInvoiceItem = z.infer<typeof fbInvoiceItemSchema>;

/** Umsatzsteuer je Satz (VAT_ITEMS) */
export const fbVatItemSchema = z.looseObject({
  VAT_PERCENT: numeric,
  COMPLETE_NET: numeric,
  VAT_VALUE: numeric,
});
export type FbVatItem = z.infer<typeof fbVatItemSchema>;

/** Zahlung zu einer Rechnung; die Doku nennt die Felder nicht, deshalb nur locker geprüft. */
export const fbPaymentSchema = z.looseObject({});
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
  CATEGORY: str,
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

/** Bytes einer Datei mit MIME-Typ und – falls bekannt – Dateiname. */
export interface FbFile {
  bytes: Uint8Array;
  mimeType: string;
  filename: string | null;
}
