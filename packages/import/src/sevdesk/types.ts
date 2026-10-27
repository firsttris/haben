import { z } from "zod";

/*
 * Zod-Schemas für die Antworten der sevDesk-API (https://my.sevdesk.de/api/v1).
 *
 * Grundsätze wie bei Lexoffice:
 * - Alle Objekte sind "loose": unbekannte Felder bleiben erhalten, keine Transforms, keine Defaults.
 *   Das geparste Objekt lässt sich unverändert archivieren.
 * - sevDesk liefert Beträge, IDs und Steuersätze meist als Text ("119.00", "19"), manchmal als Zahl.
 *   Beides wird akzeptiert; umgerechnet wird erst in map.ts.
 */

const str = z.string().nullish();
const numeric = z.union([z.string(), z.number()]).nullish();
const id = z.union([z.string(), z.number()]);

/** Verweis auf ein anderes Objekt: { id, objectName } */
const ref = z.looseObject({ id, objectName: str }).nullish();

/** Listenantwort: { objects: [...] }, mit countAll=true zusätzlich total */
export function listSchema<T extends z.ZodType>(item: T) {
  return z.looseObject({ objects: z.array(item), total: numeric });
}

// ---------------------------------------------------------------- Grundlagen

export const sevBookkeepingVersionSchema = z.looseObject({
  objects: z.looseObject({ version: str }),
});
export type SevBookkeepingVersion = z.infer<typeof sevBookkeepingVersionSchema>;

// ---------------------------------------------------------------- Kontakte

export const sevContactSchema = z.looseObject({
  id,
  objectName: str,
  /** Firmenname; bei Personen leer */
  name: str,
  surename: str,
  familyname: str,
  customerNumber: str,
  /** Ansprechpartner einer Organisation haben einen parent */
  parent: ref,
  category: ref,
  status: numeric,
  vatNumber: str,
  taxNumber: str,
});
export type SevContact = z.infer<typeof sevContactSchema>;

export const sevContactAddressSchema = z.looseObject({
  id,
  contact: ref,
  street: str,
  zip: str,
  city: str,
  /** mit embed=country das Land samt code ("de"), sonst nur der Verweis */
  country: z.looseObject({ id, objectName: str, code: str }).nullish(),
  category: ref,
  name: str,
});
export type SevContactAddress = z.infer<typeof sevContactAddressSchema>;

export const sevCommunicationWaySchema = z.looseObject({
  id,
  contact: ref,
  /** EMAIL, PHONE, WEB, MOBILE */
  type: str,
  value: str,
  main: z.union([z.boolean(), z.string(), z.number()]).nullish(),
});
export type SevCommunicationWay = z.infer<typeof sevCommunicationWaySchema>;

// ---------------------------------------------------------------- Rechnungen und Gutschriften

export const sevInvoiceSchema = z.looseObject({
  id,
  objectName: str,
  invoiceNumber: str,
  contact: ref,
  create: str,
  invoiceDate: str,
  deliveryDate: str,
  deliveryDateUntil: str,
  timeToPay: numeric,
  payDate: str,
  /** 50 Entwurf (wiederkehrend, deaktiviert), 100 Entwurf, 200 offen, 750 teilweise bezahlt, 1000 bezahlt */
  status: numeric,
  /** RE Rechnung, WKR wiederkehrend, SR Storno, MA Mahnung, TR Teilrechnung, AR Abschlag, ER Schlussrechnung */
  invoiceType: str,
  address: str,
  currency: str,
  sumNet: numeric,
  sumTax: numeric,
  sumGross: numeric,
  paidAmount: numeric,
  customerInternalNote: str,
  header: str,
});
export type SevInvoice = z.infer<typeof sevInvoiceSchema>;

export const sevCreditNoteSchema = z.looseObject({
  id,
  objectName: str,
  creditNoteNumber: str,
  contact: ref,
  create: str,
  creditNoteDate: str,
  deliveryDate: str,
  /** 100 Entwurf, 200 versendet, 300 offen, 500 teilweise, 750 teilweise bezahlt, 1000 bezahlt */
  status: numeric,
  address: str,
  currency: str,
  sumNet: numeric,
  sumTax: numeric,
  sumGross: numeric,
  paidAmount: numeric,
  payDate: str,
  customerInternalNote: str,
  header: str,
});
export type SevCreditNote = z.infer<typeof sevCreditNoteSchema>;

/** Position einer Rechnung oder Gutschrift */
export const sevDocumentPosSchema = z.looseObject({
  id,
  name: str,
  quantity: numeric,
  taxRate: numeric,
  sumNet: numeric,
  sumTax: numeric,
  sumGross: numeric,
  sumNetAccounting: numeric,
  sumTaxAccounting: numeric,
  sumGrossAccounting: numeric,
});
export type SevDocumentPos = z.infer<typeof sevDocumentPosSchema>;

// ---------------------------------------------------------------- Belege

export const sevVoucherSchema = z.looseObject({
  id,
  objectName: str,
  create: str,
  voucherDate: str,
  supplier: ref,
  supplierName: str,
  /** Belegnummer */
  description: str,
  document: ref,
  payDate: str,
  /** 50 Entwurf, 100 offen, 1000 bezahlt */
  status: numeric,
  sumNet: numeric,
  sumTax: numeric,
  sumGross: numeric,
  paidAmount: numeric,
  /** C Einnahme (credit), D Ausgabe (debit) */
  creditDebit: str,
  /** VOU Beleg, RV wiederkehrender Beleg (Vorlage) */
  voucherType: str,
  currency: str,
  paymentDeadline: str,
  deliveryDate: str,
  deliveryDateUntil: str,
});
export type SevVoucher = z.infer<typeof sevVoucherSchema>;

export const sevVoucherPosSchema = z.looseObject({
  id,
  accountingType: ref,
  accountDatev: ref,
  taxRate: numeric,
  net: z.union([z.boolean(), z.string(), z.number()]).nullish(),
  sumNet: numeric,
  sumTax: numeric,
  sumGross: numeric,
  sumNetAccounting: numeric,
  sumTaxAccounting: numeric,
  sumGrossAccounting: numeric,
  comment: str,
});
export type SevVoucherPos = z.infer<typeof sevVoucherPosSchema>;

// ---------------------------------------------------------------- Dateien

/** getPdf und Document/download: Datei als Base64 in JSON, teils in objects verpackt */
export const sevFileBodySchema = z.looseObject({
  filename: str,
  mimeType: str,
  mimetype: str,
  base64encoded: z.boolean().nullish(),
  base64Encoded: z.boolean().nullish(),
  content: z.string(),
});
export const sevFileResponseSchema = z.union([z.looseObject({ objects: sevFileBodySchema }), sevFileBodySchema]);

/** Bytes einer Datei mit MIME-Typ und – falls bekannt – Dateiname. */
export interface SevFile {
  bytes: Uint8Array;
  mimeType: string;
  filename: string | null;
}
