import { lexToCents } from "../map.ts";
import type {
  LexBookkeepingVoucherType,
  LexContact,
  LexContactAddress,
  LexPayments,
  LexPostingCategory,
  LexSalesDocument,
  LexSalesDocumentType,
  LexVoucher,
  LexVoucherListItem,
} from "../types.ts";
import { LexwareWebExportError } from "./errors.ts";
import type { WebContact, WebEntry, WebListItem } from "./schema.ts";

/*
 * Reine Umrechnung der Antworten der Web-Oberfläche in die Form der Public API. Danach läuft der Umzug
 * genau wie beim Abruf über die API (mapSalesDocument, mapVoucher, mapPayments, mapContact), und die
 * Auswertungen, die die gespeicherte Antwort lesen (taxConditions.taxType, address), finden dieselben Felder.
 * Die Originalantworten bleiben unter `web` im gespeicherten Beleg, zum Nachweis.
 */

export const SALES_TYPES: Record<string, LexSalesDocumentType> = {
  Invoice: "invoice",
  CreditNote: "creditnote",
  DownPaymentInvoice: "downpaymentinvoice",
};

export const BOOKKEEPING_TYPES: Record<string, LexBookkeepingVoucherType> = {
  SalesInvoice: "salesinvoice",
  SalesCreditNote: "salescreditnote",
  PurchaseInvoice: "purchaseinvoice",
  PurchaseCreditNote: "purchasecreditnote",
};

/** Belegart in den Werten der Public API; null für Angebote, Aufträge, Lieferscheine */
export function webVoucherType(item: Pick<WebListItem, "entityType" | "entitySubType">): LexSalesDocumentType | LexBookkeepingVoucherType | null {
  if (item.entityType === "salesvoucher") return SALES_TYPES[item.entitySubType] ?? null;
  if (item.entityType === "bookkeepingvoucher") return BOOKKEEPING_TYPES[item.entitySubType] ?? null;
  return null;
}

/** Die Web-Oberfläche schreibt "sepa_debit", die Public API "sepadebit"; offene Posten in Haben erkennen "sepadebit". */
export function webStatus(status: string | null | undefined): string {
  return status === "sepa_debit" ? "sepadebit" : (status ?? "");
}

const euro = (cents: number) => cents / 100;

// ------------------------------------------------------------ Kontakte

const EMAIL_KEYS = { BUSINESS: "business", OFFICE: "office", PRIVATE: "private", OTHER: "other" } as const;
const PHONE_KEYS = { BUSINESS: "business", OFFICE: "office", MOBILE: "mobile", PRIVATE: "private", FAX: "fax", OTHER: "other" } as const;

function groupBy<K extends string>(entries: { type: string | null | undefined; value: string | null | undefined }[], keys: Record<string, K>) {
  const groups: Partial<Record<K, string[]>> = {};
  for (const { type, value } of entries) {
    const key = keys[type ?? "OTHER"] ?? keys.OTHER!;
    if (value?.trim()) (groups[key] ??= []).push(value.trim());
  }
  return groups;
}

function address(a: { street?: string | null; supplement?: string | null; zip?: string | null; city?: string | null; countryCode?: string | null }): LexContactAddress {
  return { street: a.street, supplement: a.supplement, zip: a.zip, city: a.city, countryCode: a.countryCode };
}

export function webContact(c: WebContact): LexContact {
  const addresses = c.addresses ?? [];
  const isPerson = c.contactType === "INDIVIDUAL_PERSON";
  return {
    id: c.id,
    organizationId: c.organizationId,
    version: c.version,
    roles: {
      customer: c.customer ? { number: c.customerNumber } : undefined,
      vendor: c.vendor ? { number: c.vendorNumber } : undefined,
    },
    company: isPerson
      ? undefined
      : { name: c.name, taxNumber: c.taxNumber, vatRegistrationId: c.vatRegistrationId, allowTaxFreeInvoices: c.allowsTaxFreeInvoices },
    person: isPerson ? { salutation: c.salutation, firstName: c.firstName, lastName: c.lastName } : undefined,
    addresses: {
      billing: addresses.filter((a) => a.addressType !== "SHIPPING").map(address),
      shipping: addresses.filter((a) => a.addressType === "SHIPPING").map(address),
    },
    emailAddresses: groupBy(
      (c.emailAddresses ?? []).map((m) => ({ type: m.emailAddressType, value: m.emailAddress })),
      EMAIL_KEYS,
    ),
    phoneNumbers: groupBy(
      (c.phoneNumbers ?? []).map((p) => ({ type: p.phoneNumberType, value: p.number })),
      PHONE_KEYS,
    ),
    note: c.note,
    archived: c.archived,
  };
}

// ------------------------------------------------------------ Belegliste

export function webListItem(item: WebListItem): LexVoucherListItem {
  return {
    id: item.entityId,
    voucherType: webVoucherType(item) ?? item.entitySubType.toLowerCase(),
    voucherStatus: webStatus(item.billingStatus),
    voucherNumber: item.identificationNumber,
    voucherDate: item.voucherDate,
    createdDate: item.createdDate,
    dueDate: item.dueDate,
    contactId: item.contactId,
    contactName: item.contactName,
    totalAmount: item.totalGrossAmount,
    openAmount: item.openAmount,
    currency: "EUR",
    archived: item.archived,
  };
}

// ------------------------------------------------------------ Rechnungsmodul

/**
 * Rechnung, Gutschrift oder Abschlagsrechnung (papyrus). Maßgeblich sind die geforderten Beträge
 * (claimed…): Bei Schlussrechnungen sind die Abschläge darin schon abgezogen, deshalb geht der Beleg
 * mit closingInvoice=false weiter und mapSalesDocument zieht nichts mehr ab. In taxAmounts ist `amount`
 * brutto (RE0329: amount 624,75, taxAmount 99,75 bei 525,00 netto).
 */
export function webSalesDocument(entry: WebEntry): LexSalesDocument {
  const document = entry.document;
  if (!document) throw new LexwareWebExportError("Rechnungsdaten fehlen in der Sicherung");
  const v = document.voucher;
  const gross = lexToCents(v.claimedGrossAmount ?? v.totalGrossAmount ?? entry.details.claimedGrossAmount ?? entry.details.totalGrossAmount ?? 0);
  const rows = (v.claimedTaxAmounts?.length ? v.claimedTaxAmounts : (v.taxAmounts ?? [])).filter((t) => t.amount || t.taxAmount);
  const tax = rows.reduce((sum, t) => sum + lexToCents(t.taxAmount ?? 0), 0);
  const netGiven = v.claimedNetAmount ?? v.totalNetAmount;
  const net = netGiven != null ? lexToCents(netGiven) : gross - tax;
  const a = v.address;
  return {
    id: document.salesVoucherId ?? entry.list.entityId,
    organizationId: document.organizationId,
    createdDate: document.created ?? entry.list.createdDate,
    updatedDate: document.lastModified,
    version: document.version,
    language: v.language,
    archived: entry.list.archived,
    voucherStatus: webStatus(entry.list.billingStatus ?? v.billingStatus),
    voucherNumber: v.identificationNumber ?? entry.list.identificationNumber,
    voucherDate: v.voucherDate ?? entry.list.voucherDate ?? entry.details.voucherDate ?? "",
    dueDate: v.dueDate ?? entry.list.dueDate,
    title: v.title,
    introduction: v.introduction,
    remark: v.remark,
    address: {
      contactId: v.contactId ?? entry.list.contactId,
      name: a?.name ?? entry.list.contactName,
      supplement: a?.supplement,
      street: a?.street,
      zip: a?.zip,
      city: a?.city,
      countryCode: a?.countryAlpha2Code,
      contactPerson: a?.contactPerson,
    },
    lineItems: (v.items ?? []).map((item) => ({
      type: item.itemType,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitName: item.unitName,
      unitPrice: { currency: v.currency ?? "EUR", netAmount: item.netPrice, grossAmount: item.grossPrice, taxRatePercentage: item.taxRatePercentage },
      discountPercentage: item.discountPercentage,
      lineItemAmount: item.rowAmount,
    })),
    totalPrice: {
      currency: v.currency ?? "EUR",
      totalNetAmount: euro(net),
      totalGrossAmount: euro(gross),
      // Steuer = brutto − netto, damit die drei Summen exakt zusammenpassen
      totalTaxAmount: euro(gross - net),
    },
    taxAmounts: rows.map((t) => ({
      taxRatePercentage: t.percent ?? 0,
      taxAmount: t.taxAmount ?? 0,
      netAmount: euro(lexToCents(t.amount ?? 0) - lexToCents(t.taxAmount ?? 0)),
    })),
    taxConditions: { taxType: v.taxType },
    paymentConditions: { paymentTermLabel: v.paymentTerms, paymentTermDuration: v.paymentRange },
    shippingConditions: { shippingDate: v.shippingDate, shippingEndDate: v.shippingEndDate, shippingType: v.shippingType },
    closingInvoice: false,
    claimedGrossAmount: euro(gross),
  };
}

// ------------------------------------------------------------ Buchhaltungsbelege

/**
 * Steuer einer Position in Cent. Die Web-Oberfläche liefert je Position nur Betrag und Satz; die Steuer
 * rechnet Haben daraus wie Lexware Office: aus dem Bruttobetrag herausgerechnet bzw. auf den Nettobetrag
 * aufgeschlagen, kaufmännisch gerundet.
 */
export function itemTax(cents: number, percent: number, gross: boolean): number {
  const share = gross ? percent / (100 + percent) : percent / 100;
  return Math.sign(cents) * Math.round(Math.abs(cents) * share) + 0;
}

/**
 * Einnahme, Ausgabe oder Minderung aus der Buchhaltung. Brutto oder netto steht nur in der Antwort von
 * capsa (taxType); die Positionen mit Satz und Kategorie kommen aus voucherDetails. Als Satz zählt
 * calcPercent (der Satz, mit dem Lexware rechnet), sonst percent.
 */
export function webBookkeepingVoucher(entry: WebEntry): LexVoucher {
  const type = BOOKKEEPING_TYPES[entry.list.entitySubType];
  if (!type) throw new LexwareWebExportError(`Unbekannte Belegart „${entry.list.entitySubType}“`);
  const capsa = entry.capsa;
  const details = entry.details;
  const gross = (capsa?.taxType ?? "gross") !== "net";
  const items = (details.bookkeepingVoucherItems ?? []).map((item) => {
    const percent = item.taxRate?.calcPercent ?? item.taxRate?.percent ?? 0;
    const amount = lexToCents(item.amount);
    const category = item.correctedPostingCategory ?? item.postingCategory;
    return { amount: item.amount, taxAmount: euro(itemTax(amount, percent, gross)), taxRatePercent: percent, categoryId: category?.postingCategoryId, cents: amount };
  });
  const tax = items.reduce((sum, i) => sum + lexToCents(i.taxAmount), 0);
  const itemGross = items.reduce((sum, i) => sum + (gross ? i.cents : i.cents + lexToCents(i.taxAmount)), 0);
  const total = capsa?.totalGrossAmount ?? details.totalGrossAmount;
  return {
    id: entry.list.entityId,
    organizationId: capsa?.organizationId,
    type,
    voucherStatus: webStatus(entry.list.billingStatus ?? details.billingStatus),
    voucherNumber: entry.list.identificationNumber ?? capsa?.identificationNumber ?? details.identificationNumber,
    voucherDate: capsa?.voucherDate ?? details.voucherDate ?? entry.list.voucherDate,
    shippingDate: capsa?.shippingDate ?? entry.list.shippingDate,
    dueDate: capsa?.dueDate ?? details.dueDate ?? entry.list.dueDate,
    totalGrossAmount: total != null ? total : euro(itemGross),
    totalTaxAmount: euro(tax),
    taxType: gross ? "gross" : "net",
    contactId: capsa?.contact?.contactId ?? details.contactId ?? entry.list.contactId,
    contactName: details.contactName ?? capsa?.contact?.name ?? entry.list.contactName,
    remark: capsa?.note ?? entry.list.note,
    currency: "EUR",
    voucherItems: items.map(({ cents: _cents, ...item }) => item),
    files: entry.files.filter((f) => f.role !== "pdf").map((f) => f.path),
    createdDate: capsa?.createdDate ?? entry.list.createdDate,
  };
}

/** Buchungskategorien, wie sie in den Belegen vorkommen (eine eigene Liste liefert die Belegansicht nicht) */
export function webPostingCategories(entries: Iterable<WebEntry>): LexPostingCategory[] {
  const byId = new Map<string, LexPostingCategory>();
  for (const entry of entries) {
    for (const item of entry.details.bookkeepingVoucherItems ?? []) {
      for (const c of [item.postingCategory, item.correctedPostingCategory]) {
        if (c && !byId.has(c.postingCategoryId)) byId.set(c.postingCategoryId, { id: c.postingCategoryId, name: c.name ?? "", type: c.type ?? "" });
      }
    }
  }
  return [...byId.values()];
}

// ------------------------------------------------------------ Zahlungen

/** Zeilen der Belegansicht, die keinen Geldfluss, sondern den Stand zeigen */
const STATUS_ITEMS = new Set(["balanced", "openRevenue", "openExpense"]);

/**
 * Die Web-Oberfläche nennt eine von Hand erfasste Zahlung „Sonstige Zahlung“ (partPaymentOther); die
 * Public API kennt dafür manualPayment, und nur die bekannten Zahlungsarten zählen in Haben als Entgelt.
 */
const PAYMENT_TYPES: Record<string, string> = { partPaymentOther: "manualPayment" };

export function webPayments(entry: WebEntry): LexPayments {
  const lines = entry.details.paymentListItems ?? [];
  const status = lines.find((l) => STATUS_ITEMS.has(l.paymentItemType ?? ""))?.paymentItemType ?? null;
  const items = lines
    .filter((l) => !STATUS_ITEMS.has(l.paymentItemType ?? "") && l.postingDate && l.amount)
    .map((l) => ({
      paymentItemType: PAYMENT_TYPES[l.paymentItemType ?? ""] ?? l.paymentItemType,
      postingDate: l.postingDate,
      amount: l.amount!,
      currency: "EUR",
    }));
  const dates = items.map((i) => i.postingDate!).sort();
  return {
    openAmount: entry.list.openAmount ?? 0,
    currency: "EUR",
    paymentStatus: status,
    voucherType: webVoucherType(entry.list),
    voucherStatus: webStatus(entry.list.billingStatus),
    paidDate: status === "balanced" ? (dates.at(-1) ?? null) : null,
    paymentItems: items,
  };
}
