import { z } from "zod";

/*
 * Schemas der Sicherung aus der Web-Oberfläche von Lexware Office (apps/web/public/lexware-sicherung.js).
 * Die Antworten stammen von nicht dokumentierten Endpunkten, die die Web-Oberfläche selbst aufruft.
 * Geprüft wird nur, was Haben liest; alles ist "loose", damit die Antworten unverändert archiviert werden.
 * Beobachtet im November 2026 an einem echten Konto, siehe docs/lexoffice.md.
 */

export const WEB_EXPORT_FORMAT = "haben-lexware-web";
export const WEB_EXPORT_VERSION = 1;

const str = z.string().nullish();
const num = z.number().nullish();
const bool = z.boolean().nullish();

export const webManifestSchema = z.looseObject({
  /** WEB_EXPORT_FORMAT; geprüft beim Lesen, damit die Meldung sagt, was nicht passt */
  format: z.string(),
  version: z.number(),
  part: z.number(),
  createdAt: z.string(),
  vouchers: num,
  /** Belege, die das Skript nicht laden konnte */
  failed: z.array(z.looseObject({ id: z.string(), type: str, number: str, message: z.string() })).nullish(),
});
export type WebManifest = z.infer<typeof webManifestSchema>;

/** POST /desmos-rest/contacts/v1/search mit format "FULL", ein Element von `elements` */
export const webContactSchema = z.looseObject({
  id: z.string(),
  organizationId: str,
  version: num,
  name: str,
  /** "COMPANY" | "INDIVIDUAL_PERSON" */
  contactType: str,
  salutation: str,
  firstName: str,
  lastName: str,
  customer: bool,
  vendor: bool,
  customerNumber: z.union([z.number(), z.string()]).nullish(),
  vendorNumber: z.union([z.number(), z.string()]).nullish(),
  archived: bool,
  note: str,
  taxNumber: str,
  vatRegistrationId: str,
  allowsTaxFreeInvoices: bool,
  /** addressType "BILLING" | "SHIPPING" */
  addresses: z.array(z.looseObject({ addressType: str, street: str, supplement: str, zip: str, city: str, countryCode: str })).nullish(),
  /** emailAddressType "BUSINESS" | "OFFICE" | "PRIVATE" | "OTHER" */
  emailAddresses: z.array(z.looseObject({ emailAddressType: str, emailAddress: str })).nullish(),
  phoneNumbers: z.array(z.looseObject({ phoneNumberType: str, number: str })).nullish(),
});
export type WebContact = z.infer<typeof webContactSchema>;

/** GET /grld-rest/voucherservice/1/v200/vouchers, ein Element von `content` */
export const webListItemSchema = z.looseObject({
  entityId: z.string(),
  /** "salesvoucher" | "bookkeepingvoucher" */
  entityType: z.string(),
  /** z. B. "Invoice", "PurchaseInvoice" */
  entitySubType: z.string(),
  identificationNumber: str,
  /** "open" | "overdue" | "paid" | "paidoff" | "voided" | "sepa_debit" | … */
  billingStatus: str,
  openAmount: num,
  totalGrossAmount: num,
  archived: bool,
  voucherDate: str,
  createdDate: str,
  dueDate: str,
  shippingDate: str,
  contactId: str,
  contactName: str,
  note: str,
});
export type WebListItem = z.infer<typeof webListItemSchema>;

/** Zahlungen und offene Beträge, wie sie die Belegansicht anzeigt */
const paymentListItemSchema = z.looseObject({
  /** z. B. "partPaymentFinancialTransaction", "partPaymentOther", "balanced", "openRevenue", "openExpense" */
  paymentItemType: str,
  amount: num,
  postingDate: str,
  note: str,
});

const postingCategorySchema = z.looseObject({ postingCategoryId: z.string(), name: str, type: str });

/** GET /grld-rest/voucherservice/1/v100/voucherDetails/{typ}/{id} */
export const webDetailsSchema = z.looseObject({
  voucherId: str,
  voucherType: str,
  billingStatus: str,
  identificationNumber: str,
  voucherDate: str,
  createdDate: str,
  dueDate: str,
  shippingDate: str,
  shippingEndDate: str,
  contactId: str,
  contactName: str,
  totalGrossAmount: num,
  claimedGrossAmount: num,
  consideredEInvoice: bool,
  paymentListItems: z.array(paymentListItemSchema).nullish(),
  bookkeepingVoucherItems: z
    .array(
      z.looseObject({
        amount: z.number(),
        taxRate: z.looseObject({ percent: num, calcPercent: num }).nullish(),
        postingCategory: postingCategorySchema.nullish(),
        correctedPostingCategory: postingCategorySchema.nullish(),
      }),
    )
    .nullish(),
});
export type WebDetails = z.infer<typeof webDetailsSchema>;

const taxAmountSchema = z.looseObject({ percent: num, taxAmount: num, amount: num });

/** GET /papyrus-rest/vouchers/sales-voucher/{id} (Rechnungsmodul; abgeschlossene Belege kommen mit Status 423) */
export const webSalesDocumentSchema = z.looseObject({
  salesVoucherId: str,
  organizationId: str,
  created: str,
  lastModified: str,
  version: num,
  voucher: z.looseObject({
    voucherType: str,
    billingStatus: str,
    identificationNumber: str,
    language: str,
    contactId: str,
    address: z
      .looseObject({ name: str, supplement: str, street: str, zip: str, city: str, countryAlpha2Code: str, contactPerson: str })
      .nullish(),
    items: z
      .array(
        z.looseObject({
          itemType: str,
          name: str,
          description: str,
          quantity: num,
          unitName: str,
          netPrice: num,
          grossPrice: num,
          taxRatePercentage: num,
          discountPercentage: num,
          rowAmount: num,
        }),
      )
      .nullish(),
    /** "net" | "gross" | … wie taxConditions.taxType der Public API */
    taxType: str,
    taxAmounts: z.array(taxAmountSchema).nullish(),
    claimedTaxAmounts: z.array(taxAmountSchema).nullish(),
    totalGrossAmount: num,
    totalNetAmount: num,
    claimedGrossAmount: num,
    claimedNetAmount: num,
    currency: str,
    voucherDate: str,
    dueDate: str,
    shippingDate: str,
    shippingEndDate: str,
    shippingType: str,
    paymentTerms: str,
    paymentRange: num,
    title: str,
    introduction: str,
    remark: str,
    relatedVouchers: z.array(z.unknown()).nullish(),
  }),
});
export type WebSalesDocument = z.infer<typeof webSalesDocumentSchema>;

/** GET /capsa/capsa-rest/vouchers/v1/vouchers/{id} (Buchhaltungsbelege) */
export const webBookkeepingSchema = z.looseObject({
  voucherId: str,
  organizationId: str,
  createdDate: str,
  voucherType: str,
  identificationNumber: str,
  voucherDate: str,
  dueDate: str,
  shippingDate: str,
  note: str,
  /** "gross" | "net": ob die Beträge der Positionen brutto oder netto sind */
  taxType: str,
  totalGrossAmount: num,
  billingState: str,
  contact: z.looseObject({ contactId: str, name: str }).nullish(),
});
export type WebBookkeeping = z.infer<typeof webBookkeepingSchema>;

const fileSchema = z.looseObject({
  path: z.string(),
  /** "pdf" (Rechnungsmodul), "anhang" (Belegdatei), "xml" (E-Rechnung) */
  role: z.enum(["pdf", "anhang", "xml"]),
  mimeType: z.string(),
  filename: str,
});

/** belege/<id>.json */
export const webEntrySchema = z.looseObject({
  list: webListItemSchema,
  details: webDetailsSchema,
  document: webSalesDocumentSchema.nullish(),
  capsa: webBookkeepingSchema.nullish(),
  files: z.array(fileSchema),
});
export type WebEntry = z.infer<typeof webEntrySchema>;
