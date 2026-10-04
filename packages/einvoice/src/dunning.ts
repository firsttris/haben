import { DUNNING_LEVELS, formatEuro, type DunningAmounts, type DunningLevel } from "@haben/core";
import { formatDate, formatIban } from "./format.ts";
import { addressLines, footerColumns, renderDunningPdf } from "./pdf.ts";
import { girocodeSvg } from "./qr.ts";
import type { Buyer, Seller } from "./types.ts";

export interface DunningDocument {
  level: DunningLevel;
  /** ISO-Datum der Mahnung */
  date: string;
  /** Neue Zahlungsfrist */
  dueDate: string;
  seller: Seller;
  buyer: Buyer;
  invoice: { number: string; issueDate: string; dueDate: string };
  amounts: DunningAmounts;
  intro: string;
  closing: string;
}

const percent = (basisPoints: number) =>
  `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(basisPoints / 100)} %`;

/** Druckfertige Texte für templates/mahnung.typ */
export function dunningPdfData(doc: DunningDocument) {
  const { seller, buyer, amounts } = doc;
  const title = DUNNING_LEVELS[doc.level].title;
  const meta = [
    { label: "Datum", value: formatDate(doc.date) },
    { label: "Rechnungsnummer", value: doc.invoice.number },
  ];
  if (buyer.kundennummer) meta.push({ label: "Kundennummer", value: buyer.kundennummer });

  const rows = [{ label: "Offener Rechnungsbetrag", value: formatEuro(amounts.open) }];
  if (amounts.fee) rows.push({ label: "Mahngebühr", value: formatEuro(amounts.fee) });
  if (amounts.flatFee) rows.push({ label: "Verzugspauschale (§ 288 Abs. 5 BGB)", value: formatEuro(amounts.flatFee) });
  if (amounts.interest) {
    rows.push({
      label: `Verzugszinsen ${percent(amounts.interestRate)} p. a. für ${amounts.interestDays} Tage`,
      value: formatEuro(amounts.interest),
    });
  }

  const account = seller.iban ? ` auf das Konto IBAN ${formatIban(seller.iban)}${seller.bic ? ` (BIC ${seller.bic})` : ""}` : "";
  return {
    docTitle: `${title} zur Rechnung ${doc.invoice.number}`,
    author: seller.name,
    title,
    reference: `zur Rechnung ${doc.invoice.number} vom ${formatDate(doc.invoice.issueDate)}`,
    senderLine: [seller.name, seller.strasse, `${seller.plz} ${seller.ort}`].join(" · "),
    recipient: [buyer.name, ...addressLines(buyer)],
    meta,
    salutation: "Sehr geehrte Damen und Herren,",
    intro: doc.intro.trim(),
    invoices: [
      {
        number: doc.invoice.number,
        date: formatDate(doc.invoice.issueDate),
        due: formatDate(doc.invoice.dueDate),
        open: formatEuro(amounts.open),
      },
    ],
    rows,
    total: { label: "Zu zahlen", value: formatEuro(amounts.total) },
    payment: `Bitte überweisen Sie ${formatEuro(amounts.total)} bis zum ${formatDate(doc.dueDate)}${account} unter Angabe der Rechnungsnummer ${doc.invoice.number}.`,
    qr: seller.iban
      ? girocodeSvg({ name: seller.name, iban: seller.iban, ...(seller.bic ? { bic: seller.bic } : {}), amount: amounts.total, text: `Rechnung ${doc.invoice.number}` })
      : null,
    closing: doc.closing.trim(),
    greeting: `Mit freundlichen Grüßen\n${seller.name}`,
    footer: footerColumns(seller),
  };
}

export function buildDunningPdf(doc: DunningDocument): Uint8Array {
  return renderDunningPdf(dunningPdfData(doc), doc.date);
}
