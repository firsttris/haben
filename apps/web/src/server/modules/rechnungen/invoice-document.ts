import {
  customerNumberProblem,
  describeExchangeRate,
  discountFromColumns,
  effectiveCustomerNumber,
  firstEmail,
  legalInfo,
  UNITS,
  usesCustomerNumber,
  type InvoiceTotals,
} from "@haben/core";
import type { Buyer, DirectDebit, InvoiceDocument, InvoiceFormat, Seller } from "@haben/einvoice";
import type { Company, Contact } from "../stammdaten/index.ts";
import type { Invoice, InvoiceLine } from "./invoices.ts";
import { paidPaymentOf } from "./lastschrift.ts";
import { documentReferences } from "./order-references.ts";

/* Beleg einer Rechnung für PDF und XML: Titel, Verkäufer, Käufer samt Kundennummer, Positionen und Rabatte */

/** Titel je Rechnung, auch für Buchungstext und E-Mail */
export function invoiceTitle(invoice: Pick<Invoice, "kind" | "variant">): string {
  if (invoice.kind === "rechnung" && invoice.variant) return { abschlag: "Abschlagsrechnung", schluss: "Schlussrechnung" }[invoice.variant];
  return { rechnung: "Rechnung", storno: "Stornorechnung", korrektur: "Rechnungskorrektur" }[invoice.kind];
}

export function sellerFrom(company: Company): Seller {
  return {
    name: company.name,
    strasse: company.strasse,
    plz: company.plz,
    ort: company.ort,
    land: "DE",
    email: company.email,
    ...(company.telefon ? { telefon: company.telefon } : {}),
    ...(company.steuernummer ? { steuernummer: company.steuernummer } : {}),
    ...(company.ustId ? { ustId: company.ustId } : {}),
    ...(company.iban ? { iban: company.iban } : {}),
    ...(company.bic ? { bic: company.bic } : {}),
    ...(company.bank ? { bank: company.bank } : {}),
    ...(company.kontoinhaber ? { kontoinhaber: company.kontoinhaber } : {}),
    ...sellerLegalInfo(company),
  };
}

/** GmbH und UG: Pflichtangaben für Geschäftsbriefe (§ 35a Abs. 1 GmbHG) aus den Firmendaten */
function sellerLegalInfo(company: Company): Pick<Seller, "legalInfo"> {
  const info = legalInfo(company);
  return info ? { legalInfo: info } : {};
}

/**
 * Absender eines festgeschriebenen Belegs mit den Pflichtangaben von heute: Mahnung, Auftragsbestätigung und
 * Lieferschein sind neue Briefe und brauchen sie auch dann, wenn der Beleg älter ist als die Angaben.
 */
export function withCurrentLegalInfo(seller: Seller, company: Company): Seller {
  const { legalInfo: _snapshot, ...rest } = seller;
  return { ...rest, ...sellerLegalInfo(company) };
}

/** Käufer eines Belegs aus dem Kontakt; mit Ansprechpartner (Stand der Person beim Festschreiben, #424) */
export function buyerFrom(contact: Contact, ansprechpartner?: Buyer["ansprechpartner"]): Buyer {
  return {
    name: contact.name,
    strasse: contact.strasse,
    plz: contact.plz,
    ort: contact.ort,
    land: contact.land,
    // Die E-Rechnung kennt nur eine Adresse des Käufers (BT-49); weitere Empfänger nimmt der Versand aus dem Kontakt
    ...(firstEmail(contact.email) ? { email: firstEmail(contact.email) } : {}),
    ...(contact.ustId ? { ustId: contact.ustId } : {}),
    ...(contact.leitwegId ? { leitwegId: contact.leitwegId } : {}),
    ...(contact.kundennummer ? { kundennummer: contact.kundennummer } : {}),
    ...(contact.unsereLieferantennummer ? { unsereLieferantennummer: contact.unsereLieferantennummer } : {}),
    ...(ansprechpartner ? { ansprechpartner } : {}),
  };
}

export function documentFor(
  invoice: Invoice,
  lines: InvoiceLine[],
  totals: InvoiceTotals,
  euroTotals: InvoiceTotals,
  seller: Seller,
  buyer: Buyer,
  number: string,
  corrects: { number: string; issueDate: string } | null,
  deducted: { number: string; issueDate: string }[] = [],
  directDebit?: DirectDebit,
  /** Codes eigener Einheiten (#748) aus loadUnitCodes; feste Einheiten brauchen keinen */
  unitCodes: Readonly<Record<string, string>> = {},
): InvoiceDocument {
  const paidPayment = paidPaymentOf(invoice);
  return {
    kind: invoice.kind,
    format: invoice.format as InvoiceFormat,
    number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    paymentTermDays: invoice.paymentTermDays,
    ...(paidPayment ? { paidPayment } : {}),
    ...(invoice.kind === "rechnung" && invoice.skonto.length > 0 ? { skonto: invoice.skonto } : {}),
    ...(invoice.serviceFrom ? { serviceFrom: invoice.serviceFrom } : {}),
    ...(invoice.serviceTo ? { serviceTo: invoice.serviceTo } : {}),
    currency: invoice.currency,
    // Fremdwährung: die Umsatzsteuer zusätzlich in Euro (§ 14 Abs. 4 Nr. 8 UStG), mit Kurs und Herkunft
    ...(invoice.currency !== "EUR" && invoice.exchangeRate
      ? {
          euroTax: {
            tax: euroTotals.tax,
            taxes: euroTotals.taxes.map((t) => ({ rate: t.rate, tax: t.tax })),
            rate: describeExchangeRate(invoice.currency, invoice.exchangeRate, invoice.exchangeRateSource, invoice.exchangeRateDate),
          },
        }
      : {}),
    seller,
    buyer,
    lines: lines.map((line) => ({
      position: line.position,
      description: line.description,
      ...(line.detail ? { detail: line.detail } : {}),
      ...(line.itemNumber ? { itemNumber: line.itemNumber } : {}),
      quantity: line.quantity,
      unit: line.unit,
      ...(!Object.hasOwn(UNITS, line.unit) && unitCodes[line.unit] ? { unitCode: unitCodes[line.unit] } : {}),
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
      net: line.net,
      ...lineDiscountOf(line),
      ...(line.deductionOf ? { deductionOf: line.deductionOf } : {}),
    })),
    totals,
    ...invoiceDiscountOf(invoice),
    ...(corrects ? { corrects } : {}),
    ...(invoice.intro ? { intro: invoice.intro } : {}),
    ...(invoice.note ? { note: invoice.note } : {}),
    ...(invoice.propertyRetention ? { propertyRetention: true } : {}),
    ...documentReferences(invoice),
    ...(invoice.taxTreatment !== "regulaer" ? { taxTreatment: invoice.taxTreatment } : {}),
    ...(invoice.exemptionReason ? { exemptionReason: invoice.exemptionReason } : {}),
    ...(invoice.priceMode === "brutto" ? { priceMode: invoice.priceMode } : {}),
    language: invoice.language,
    ...(invoice.kind === "rechnung" && invoice.variant ? { variant: invoice.variant } : {}),
    ...(deducted.length > 0 ? { deducted } : {}),
    ...(directDebit ? { directDebit } : {}),
  };
}

/** Positionsrabatt einer gespeicherten Position, für PDF, XML und neue Entwürfe */
export function lineDiscountOf(line: { discountPercent: number | null; discountAmount: number | null }) {
  const discount = discountFromColumns(line.discountPercent, line.discountAmount);
  return discount ? { discount } : {};
}

/** Gesamtrabatt einer gespeicherten Rechnung oder eines Angebots */
export function invoiceDiscountOf(invoice: { discountPercent: number | null; discountAmount: number | null }) {
  const discount = discountFromColumns(invoice.discountPercent, invoice.discountAmount);
  return discount ? { discount } : {};
}

/**
 * Probleme beim Käufer vor dem Festschreiben: fehlt er, fehlt seine Kundennummer für {KUNDENNR} oder taugt sie nicht
 * als Teil der Nummer. Storno und Korrektur nehmen die Kundennummer des Originals, solange sie taugt, sonst die
 * heutige des Kontakts (#1426).
 */
export function buyerIssues(format: string, contact: Contact | null, corrects: { buyer: Buyer | null } | null = null): string[] {
  const issues = contact ? [] : ["Kunde fehlt"];
  if (usesCustomerNumber(format) && (contact || corrects)) {
    const problem = customerNumberProblem(effectiveCustomerNumber(corrects?.buyer, contact));
    // ganze Sätze ohne Schlusspunkt in die Liste, „Noch nicht bereit: …“ setzt ihn selbst
    if (problem) issues.push(problem.replace(/\.$/, ""));
  }
  return issues;
}

/**
 * Käufer für das Festschreiben: bei Storno und Korrektur der festgeschriebene des Originals. Trug der noch keine
 * verwendbare Kundennummer für {KUNDENNR}, steht hier die heutige des Kontakts, mit der nummeriert wird (#1426).
 */
export function numberedBuyer(original: Buyer | null, contact: Contact, ansprechpartner: Buyer["ansprechpartner"], format: string): Buyer {
  const buyer = original ?? buyerFrom(contact, ansprechpartner);
  const kundennummer = usesCustomerNumber(format) ? effectiveCustomerNumber(original, contact) : buyer.kundennummer;
  return kundennummer && kundennummer !== buyer.kundennummer ? { ...buyer, kundennummer } : buyer;
}
