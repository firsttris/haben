import { z } from "zod";

/*
 * Zod-Schemas für die Antworten der Lexware Office Public API (vormals lexoffice).
 *
 * Grundsätze:
 * - Alle Objekte sind "loose": unbekannte Felder bleiben erhalten. Es gibt bewusst
 *   keine Transforms und keine Defaults, d. h. das geparste Objekt ist inhaltlich
 *   identisch mit dem gelieferten JSON und kann unverändert archiviert werden.
 * - Alles, was die Doku als optional führt oder was bei Entwürfen / ungeprüften
 *   Belegen fehlen kann, ist `nullish` (fehlend oder null).
 * - Wo sich die Referenz-Clients widersprechen, wird beides akzeptiert
 *   (z. B. `taxRatePercentage` bei Rechnungen vs. `taxRatePercent` bei Belegen).
 */

const str = z.string().nullish();
const num = z.number().nullish();
const bool = z.boolean().nullish();

/** Spring-Page, wie sie /contacts und /voucherlist liefern. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.looseObject({
    content: z.array(item),
    first: bool,
    last: bool,
    totalPages: num,
    totalElements: num,
    number: num,
    size: num,
    numberOfElements: num,
  });
}
export interface LexPage<T> {
  content: T[];
  first?: boolean | null;
  last?: boolean | null;
  totalPages?: number | null;
  totalElements?: number | null;
  number?: number | null;
  size?: number | null;
  numberOfElements?: number | null;
}

// ---------------------------------------------------------------- Profil

export const lexProfileSchema = z.looseObject({
  organizationId: z.string(),
  companyName: str,
  created: z.looseObject({ userId: str, userName: str, userEmail: str, date: str }).nullish(),
  connectionId: str,
  features: z.array(z.string()).nullish(),
  businessFeatures: z.array(z.string()).nullish(),
  subscriptionStatus: str,
  taxType: str,
  distanceSalesPrinciple: str,
  smallBusiness: bool,
});
export type LexProfile = z.infer<typeof lexProfileSchema>;

// ---------------------------------------------------------------- Buchungskategorien

export const lexPostingCategorySchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  /** "income" | "outgo" */
  type: z.string(),
  contactRequired: bool,
  splitAllowed: bool,
  groupName: str,
});
export type LexPostingCategory = z.infer<typeof lexPostingCategorySchema>;
export const lexPostingCategoriesSchema = z.array(lexPostingCategorySchema);

// ---------------------------------------------------------------- Kontakte

const contactRoleSchema = z.looseObject({ number: z.union([z.number(), z.string()]).nullish() });

const contactAddressSchema = z.looseObject({
  supplement: str,
  street: str,
  zip: str,
  city: str,
  countryCode: str,
});
export type LexContactAddress = z.infer<typeof contactAddressSchema>;

const stringList = z.array(z.string()).nullish();

export const lexContactSchema = z.looseObject({
  id: z.string(),
  organizationId: str,
  version: num,
  roles: z.looseObject({ customer: contactRoleSchema.nullish(), vendor: contactRoleSchema.nullish() }).nullish(),
  company: z
    .looseObject({
      name: str,
      taxNumber: str,
      vatRegistrationId: str,
      allowTaxFreeInvoices: bool,
      contactPersons: z
        .array(
          z.looseObject({
            salutation: str,
            firstName: str,
            lastName: str,
            primary: bool,
            emailAddress: str,
            phoneNumber: str,
          }),
        )
        .nullish(),
    })
    .nullish(),
  person: z.looseObject({ salutation: str, firstName: str, lastName: str }).nullish(),
  addresses: z
    .looseObject({ billing: z.array(contactAddressSchema).nullish(), shipping: z.array(contactAddressSchema).nullish() })
    .nullish(),
  emailAddresses: z
    .looseObject({ business: stringList, office: stringList, private: stringList, other: stringList })
    .nullish(),
  phoneNumbers: z
    .looseObject({
      business: stringList,
      office: stringList,
      mobile: stringList,
      private: stringList,
      fax: stringList,
      other: stringList,
    })
    .nullish(),
  note: str,
  archived: bool,
});
export type LexContact = z.infer<typeof lexContactSchema>;

// ---------------------------------------------------------------- Belegliste

export const LEX_VOUCHER_LIST_TYPES = [
  "salesinvoice",
  "salescreditnote",
  "purchaseinvoice",
  "purchasecreditnote",
  "invoice",
  "downpaymentinvoice",
  "creditnote",
  "orderconfirmation",
  "quotation",
  "deliverynote",
] as const;
export type LexVoucherListType = (typeof LEX_VOUCHER_LIST_TYPES)[number];

/** Rechnungsmodul: Detail per /invoices, /credit-notes, /down-payment-invoices. */
export const LEX_SALES_DOCUMENT_TYPES = ["invoice", "creditnote", "downpaymentinvoice"] as const;
export type LexSalesDocumentType = (typeof LEX_SALES_DOCUMENT_TYPES)[number];

/** Buchhaltungsbelege: Detail per /vouchers/{id}. */
export const LEX_BOOKKEEPING_VOUCHER_TYPES = [
  "salesinvoice",
  "salescreditnote",
  "purchaseinvoice",
  "purchasecreditnote",
] as const;
export type LexBookkeepingVoucherType = (typeof LEX_BOOKKEEPING_VOUCHER_TYPES)[number];

export const lexVoucherListItemSchema = z.looseObject({
  id: z.string(),
  voucherType: z.string(),
  voucherStatus: str,
  voucherNumber: str,
  voucherDate: str,
  createdDate: str,
  updatedDate: str,
  dueDate: str,
  contactId: str,
  contactName: str,
  totalAmount: num,
  openAmount: num,
  currency: str,
  archived: bool,
});
export type LexVoucherListItem = z.infer<typeof lexVoucherListItemSchema>;

// ---------------------------------------------------------------- Rechnungen / Gutschriften / Abschlagsrechnungen

const taxAmountSchema = z.looseObject({
  /** Rechnungsmodul (laut Doku und den meisten Clients) */
  taxRatePercentage: num,
  /** Schreibweise der Buchhaltungsbelege – vorsorglich ebenfalls akzeptiert */
  taxRatePercent: num,
  taxAmount: num,
  netAmount: num,
});

export const lexSalesDocumentSchema = z.looseObject({
  id: str,
  organizationId: str,
  createdDate: str,
  updatedDate: str,
  version: num,
  language: str,
  archived: bool,
  voucherStatus: str,
  voucherNumber: str,
  voucherDate: z.string(),
  dueDate: str,
  title: str,
  introduction: str,
  remark: str,
  address: z
    .looseObject({
      contactId: str,
      name: str,
      supplement: str,
      street: str,
      zip: str,
      city: str,
      countryCode: str,
      contactPerson: str,
    })
    .nullish(),
  lineItems: z
    .array(
      z.looseObject({
        id: str,
        type: str,
        name: str,
        description: str,
        quantity: num,
        unitName: str,
        unitPrice: z
          .looseObject({ currency: str, netAmount: num, grossAmount: num, taxRatePercentage: num })
          .nullish(),
        discountPercentage: num,
        lineItemAmount: num,
      }),
    )
    .nullish(),
  totalPrice: z
    .looseObject({
      currency: str,
      totalNetAmount: num,
      totalGrossAmount: num,
      totalTaxAmount: num,
      totalDiscountAbsolute: num,
      totalDiscountPercentage: num,
    })
    .nullish(),
  taxAmounts: z.array(taxAmountSchema).nullish(),
  taxConditions: z.looseObject({ taxType: str, taxSubType: str, taxTypeNote: str }).nullish(),
  paymentConditions: z
    .looseObject({ paymentTermLabel: str, paymentTermLabelTemplate: str, paymentTermDuration: num })
    .nullish(),
  shippingConditions: z.looseObject({ shippingDate: str, shippingEndDate: str, shippingType: str }).nullish(),
  closingInvoice: bool,
  claimedGrossAmount: num,
  /** Bei Schlussrechnungen: die abgezogenen Abschlagsrechnungen */
  downPaymentDeductions: z
    .array(
      z.looseObject({
        id: str,
        voucherType: str,
        voucherNumber: str,
        receivedNetAmount: num,
        receivedTaxAmount: num,
        receivedGrossAmount: num,
        taxRatePercentage: num,
      }),
    )
    .nullish(),
  files: z.looseObject({ documentFileId: str }).nullish(),
  relatedVouchers: z.array(z.looseObject({ id: str, voucherNumber: str, voucherType: str })).nullish(),
});
export type LexSalesDocument = z.infer<typeof lexSalesDocumentSchema>;

export const lexDocumentFileSchema = z.looseObject({ documentFileId: z.string() });

// ---------------------------------------------------------------- Buchhaltungsbelege

export const lexVoucherSchema = z.looseObject({
  id: str,
  organizationId: str,
  type: z.string(),
  voucherStatus: str,
  /** Manche Antworten liefern den Status unter `status` (siehe lexware-mcp-server). */
  status: str,
  voucherNumber: str,
  voucherDate: str,
  shippingDate: str,
  dueDate: str,
  totalGrossAmount: num,
  totalTaxAmount: num,
  /** "net" | "gross" */
  taxType: str,
  useCollectiveContact: bool,
  contactId: str,
  contactName: str,
  remark: str,
  currency: str,
  voucherItems: z
    .array(
      z.looseObject({
        amount: z.number(),
        taxAmount: num,
        taxRatePercent: num,
        categoryId: str,
      }),
    )
    .nullish(),
  files: z.array(z.string()).nullish(),
  createdDate: str,
  updatedDate: str,
  version: num,
});
export type LexVoucher = z.infer<typeof lexVoucherSchema>;

// ---------------------------------------------------------------- Zahlungen

export const lexPaymentsSchema = z.looseObject({
  openAmount: num,
  currency: str,
  /** "balanced" | "openRevenue" | "openExpense" */
  paymentStatus: str,
  voucherType: str,
  voucherStatus: str,
  paidDate: str,
  paymentItems: z
    .array(z.looseObject({ paymentItemType: str, postingDate: str, amount: z.number(), currency: str }))
    .nullish(),
});
export type LexPayments = z.infer<typeof lexPaymentsSchema>;

// ---------------------------------------------------------------- Dateien

export interface LexFile {
  bytes: Uint8Array;
  /** aus Content-Type, ohne Parameter, klein geschrieben */
  mimeType: string;
  /** aus Content-Disposition (filename* bevorzugt), sonst null */
  filename: string | null;
}
