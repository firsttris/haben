import { DUNNING_LEVELS, formatEuro, type DunningAmounts, type DunningLevel } from "@haben/core";
import { accountHolder, formatDate, formatIban } from "./format.ts";
import { TEXTS } from "./i18n.ts";
import { addressLines, asDraft, draftFilename, footerData, renderDunningPdf, showsCustomerNumber, type DraftPdf } from "./pdf.ts";
import { girocodeSvg } from "./qr.ts";
import type { Buyer, Letterhead, Seller } from "./types.ts";

export interface DunningDocument extends Letterhead {
  level: DunningLevel;
  /** ISO-Datum der Mahnung */
  date: string;
  /** Neue Zahlungsfrist */
  dueDate: string;
  seller: Seller;
  buyer: Buyer;
  /** skontoExpired: Die Rechnung bot Skonto an; nach Fristablauf weist die Mahnung darauf hin, dass es entfallen ist */
  invoice: { number: string; issueDate: string; dueDate: string; skontoExpired?: boolean };
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
  if (showsCustomerNumber(doc)) meta.push({ label: "Kundennummer", value: buyer.kundennummer! });

  const rows = [{ label: "Offener Rechnungsbetrag", value: formatEuro(amounts.open) }];
  // Mit Pauschale ist amounts.fee nur der Teil der Mahngebühr, der die Pauschale übersteigt (§ 288 Abs. 5 Satz 3 BGB)
  if (amounts.fee) rows.push({ label: amounts.flatFee ? "Mahngebühr, soweit über der Pauschale" : "Mahngebühr", value: formatEuro(amounts.fee) });
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
    payment: [
      `Bitte überweisen Sie ${formatEuro(amounts.total)} bis zum ${formatDate(doc.dueDate)}${account} unter Angabe der Rechnungsnummer ${doc.invoice.number}.`,
      ...(doc.invoice.skontoExpired ? ["Das Skonto aus der Rechnung ist mit Ablauf der Skontofrist entfallen."] : []),
    ].join(" "),
    qr:
      seller.iban && doc.options?.giroCode !== false
        ? girocodeSvg({
            name: accountHolder(seller),
            iban: seller.iban,
            ...(seller.bic ? { bic: seller.bic } : {}),
            amount: amounts.total,
            text: `Rechnung ${doc.invoice.number}`,
          })
        : null,
    closing: doc.closing.trim(),
    greeting: `Mit freundlichen Grüßen\n${seller.name}`,
    ...footerData(seller),
  };
}

export function buildDunningPdf(doc: DunningDocument): Uint8Array {
  return renderDunningPdf(dunningPdfData(doc), doc.date, doc);
}

/** Mahnung als Entwurf: „ENTWURF“ über jeder Seite, statt des GiroCodes ein Platzhalter; Mahnungen sind deutsch */
export function buildDunningDraftPdf(doc: DunningDocument): DraftPdf {
  const data = dunningPdfData(doc);
  return { pdf: renderDunningPdf(asDraft(data, TEXTS.de), doc.date, doc), filename: draftFilename(data.title, doc.date, TEXTS.de) };
}
