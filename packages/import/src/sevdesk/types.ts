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
  /** Contact-Tags laut OpenAPI: 2 Lieferant, 3 Kunde, 4 Partner, 28 Interessent. */
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
  /** Name des Lieferanten beim Speichern des Belegs; bleibt beim Umbenennen des Kontakts gleich */
  supplierNameAtSave: str,
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
  /** C Ausgabe (credit), D Einnahme (debit); belegt mit echten Antworten, siehe mapSevVoucher */
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

/** Order umfasst Angebote (AN), Auftragsbestätigungen (AB) und Lieferscheine (LI). */
export const sevOrderSchema = z.looseObject({
  id,
  objectName: str,
  orderType: str,
  orderNumber: str,
  orderDate: str,
  create: str,
  status: numeric,
  contact: ref,
  address: str,
  currency: str,
  sumNet: numeric,
  sumTax: numeric,
  sumGross: numeric,
  sumNetForeignCurrency: numeric,
  sumTaxForeignCurrency: numeric,
  sumGrossForeignCurrency: numeric,
});
export type SevOrder = z.infer<typeof sevOrderSchema>;
// ---------------------------------------------------------------- Buchungskonten

/**
 * Kontostamm (GET /AccountingType/{id}), nur in Buchhaltungsversion 1.0. Der Pfad fehlt unter den Pfaden der OpenAPI und
 * steht nur im Abschnitt „Accounting type“ (Tag Voucher). Typisiert sind nur die Felder, die Haben liest; `type` und
 * `translationCode` entscheiden nichts (#472).
 */
export const sevAccountingTypeSchema = z.looseObject({
  id,
  skr03: str,
  skr04: str,
  parent: ref,
  translationCode: str,
});
export type SevAccountingType = z.infer<typeof sevAccountingTypeSchema>;

// ---------------------------------------------------------------- Zahlungen

/** Zahlungskonto (Bank, Kasse, Zahlungsdienst) */
export const sevCheckAccountSchema = z.looseObject({ id, objectName: str, name: str, type: str, currency: str });
export type SevCheckAccount = z.infer<typeof sevCheckAccountSchema>;

/** Bankumsatz, eingebettet in CheckAccountTransactionLog (embed=checkAccountTransaction) */
export const sevCheckAccountTransactionSchema = z.looseObject({
  id,
  objectName: str,
  valueDate: str,
  entryDate: str,
  amount: numeric,
  checkAccount: ref,
  status: numeric,
  deletedAt: str,
});

/**
 * Zuordnung eines Bankumsatzes zu einem Beleg (Rechnung, Gutschrift, Beleg) mit dem zugeordneten Betrag. Ein geteilter
 * Umsatz hat je Beleg einen eigenen Eintrag. Belegt mit echten V1-Antworten (#343); in der OpenAPI nicht beschrieben.
 */
export const sevCheckAccountTransactionLogSchema = z.looseObject({
  id,
  objectName: str,
  create: str,
  /** Mit embed=checkAccountTransaction der ganze Umsatz, sonst nur { id, objectName } */
  checkAccountTransaction: sevCheckAccountTransactionSchema.nullish(),
  fromStatus: numeric,
  toStatus: numeric,
  amountPaid: numeric,
  bookingDate: str,
  object: ref,
});
export type SevCheckAccountTransactionLog = z.infer<typeof sevCheckAccountTransactionLogSchema>;

// V1 liefert bei Beziehungen teils ein Objekt mit lückenhaften Zahlenschlüsseln, sonst eine Liste.
// Die Form und alle unbekannten Felder bleiben für die unveränderte Archivantwort erhalten.
export const sevRelatedObjectsResponseSchema = z.looseObject({
  objects: z.union([z.array(z.record(z.string(), z.unknown())), z.record(z.string(), z.unknown())]),
});

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
