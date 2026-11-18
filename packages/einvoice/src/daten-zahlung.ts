import { formatEuro, formatPercent, skontoPaymentTerms } from "@haben/core";
import { accountHolder, collectedByDirectDebit, compactIban, formatDate, invoiceSkonto, paidInvoicePayment, paymentSentence, servicePeriod } from "./format.ts";
import type { Invoice } from "./modell.ts";
import type { InvoiceDocument } from "./types.ts";

/* Lieferung, Zahlungsweg und Zahlungsbedingungen im Rechnungsmodell (daten.ts) */

/**
 * Zahlungsbedingungen (BT-20): bei Skonto zuerst je Stufe die Zeile nach XRechnung BR-DE-18 (#SKONTO#TAGE=…#PROZENT=…#
 * mit Zeilenumbruch), die Empfänger maschinell lesen, danach derselbe Inhalt als Satz mit Datum und Betrag
 */
function paymentTerms(doc: InvoiceDocument): string {
  // Lastschrift: die Vorabankündigung wie im PDF, ohne Skonto (eingezogen wird der volle Betrag)
  if (collectedByDirectDebit(doc)) return paymentSentence(doc);
  const skonto = invoiceSkonto(doc);
  const text = [
    `Zahlbar ohne Abzug bis zum ${formatDate(doc.dueDate)} (${doc.paymentTermDays} Tage).`,
    ...skonto.map((s) => `Bei Zahlung bis zum ${formatDate(s.until)} (${s.days} Tage) ${formatPercent(s.percent)} Skonto, ${formatEuro(s.amount)}.`),
  ].join(" ");
  return `${skontoPaymentTerms(skonto)}${text}`;
}

/** Lieferdatum bzw. Leistungszeitraum (BG-13, BG-14) und die Lieferanschrift (BG-15) */
export function setDelivery(invoice: Invoice, doc: InvoiceDocument): void {
  const { buyer } = doc;
  const treatment = doc.taxTreatment ?? "regulaer";
  const period = servicePeriod(doc);
  // BR-IC-12 verlangt bei innergemeinschaftlicher Lieferung das Lieferland (BT-80). Bei Zeiträumen füllt die
  // Lieferanschrift außerdem den CII-Pflichtblock (Factur-X 1.08, BR-FX-EN-04), ohne ein Leistungsdatum zu erfinden.
  // Zu BG-15 verlangt XRechnung auch Ort und Postleitzahl (BR-DE-10, BR-DE-11). Haben nimmt die Kundenanschrift
  // als Bestimmungsort an; eine abweichende Lieferanschrift kennt es nicht (siehe docs/rechnungen.md).
  const deliveryLocation =
    treatment === "ig_lieferung" || period.from !== period.to
      ? {
          "cac:DeliveryLocation": {
            "cac:Address": {
              "cbc:StreetName": buyer.strasse,
              "cbc:CityName": buyer.ort,
              "cbc:PostalZone": buyer.plz,
              "cac:Country": { "cbc:IdentificationCode": buyer.land.toUpperCase() },
            },
          },
        }
      : {};
  if (period.from === period.to) {
    invoice["cac:Delivery"] = { "cbc:ActualDeliveryDate": period.from, ...deliveryLocation };
  } else {
    invoice["cac:InvoicePeriod"] = { "cbc:StartDate": period.from, "cbc:EndDate": period.to };
    invoice["cac:Delivery"] = deliveryLocation;
  }
}

/** Zahlungsweg (BG-16) und Zahlungsbedingungen (BT-20); bezahlt, Lastschrift, Überweisung oder Erstattung */
export function setPayment(invoice: Invoice, doc: InvoiceDocument, credit: boolean): void {
  const { seller } = doc;
  const paid = paidInvoicePayment(doc);
  if (paid) {
    // BT-81 nach UNTDID 4461: 10 = bar, 68 = Online-Zahlungsdienst. Bei BT-115 = 0 entfällt die Frist (BR-CO-25).
    // https://docs.peppol.eu/poacc/billing/3.0/codelist/UNCL4461/
    invoice["cac:PaymentMeans"] = [{ "cbc:PaymentMeansCode": paid.paidVia.toLowerCase() === "bar" ? "10" : "68" }];
  } else if (!credit) {
    invoice["cbc:DueDate"] = doc.dueDate;
    if (collectedByDirectDebit(doc)) {
      // SEPA-Lastschrift: 59 nach UNTDID 4461, Mandat (BT-89) und Konto des Kunden (BT-91) in cac:PaymentMandate; ohne
      // Konto des Verkäufers (XRechnung BR-DE-25-b). Die Gläubiger-ID (BT-90) steht beim Verkäufer, siehe sellerIds
      invoice["cac:PaymentMeans"] = [
        {
          "cbc:PaymentMeansCode": "59",
          "cbc:PaymentID": doc.number,
          "cac:PaymentMandate": {
            "cbc:ID": doc.directDebit.mandateReference,
            "cac:PayerFinancialAccount": { "cbc:ID": compactIban(doc.directDebit.debtorIban) },
          },
        },
      ];
    } else if (seller.iban) {
      invoice["cac:PaymentMeans"] = [
        {
          "cbc:PaymentMeansCode": "58",
          "cbc:PaymentID": doc.number,
          "cac:PayeeFinancialAccount": {
            "cbc:ID": compactIban(seller.iban),
            // BT-85 Name des Zahlungskontos: der Kontoinhaber, sonst der Firmenname
            "cbc:Name": accountHolder(seller),
            ...(seller.bic ? { "cac:FinancialInstitutionBranch": { "cbc:ID": seller.bic } } : {}),
          },
        },
      ];
    } else {
      // Nichts zu zahlen und keine IBAN: BG-16 ist trotzdem Pflicht (BR-DE-1), Zahlungsweg nicht festgelegt
      invoice["cac:PaymentMeans"] = [{ "cbc:PaymentMeansCode": "1", "cbc:PaymentID": doc.number }];
    }
    invoice["cac:PaymentTerms"] = { "cbc:Note": paymentTerms(doc) };
  } else {
    // Erstattung an den Kunden: Zahlungsweg nicht festgelegt
    invoice["cac:PaymentMeans"] = [{ "cbc:PaymentMeansCode": "1", "cbc:PaymentID": doc.number }];
    invoice["cac:PaymentTerms"] = { "cbc:Note": paymentSentence(doc) };
  }
}
