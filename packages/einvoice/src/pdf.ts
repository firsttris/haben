import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { formatEuro, formatQuantity, formatRate, treatmentNote } from "@haben/core";
import { countryName, formatDate, formatIban, paymentSentence, TITLES } from "./format.ts";
import type { Address, InvoiceDocument } from "./types.ts";

// Paketverzeichnis mit templates/ und fonts/; im gebündelten Server per HABEN_EINVOICE_DIR gesetzt.
const PACKAGE_DIR = process.env.HABEN_EINVOICE_DIR ?? fileURLToPath(new URL("..", import.meta.url));
const TEMPLATE = join(PACKAGE_DIR, "templates", "rechnung.typ");
const FONTS = ["Regular", "Medium", "SemiBold"].map((weight) => join(PACKAGE_DIR, "fonts", `IBMPlexSans-${weight}.ttf`));

let compiler: NodeCompiler | undefined;

function getCompiler(): NodeCompiler {
  compiler ??= NodeCompiler.create({
    workspace: join(PACKAGE_DIR, "templates"),
    fontArgs: [{ fontBlobs: FONTS.map((path) => readFileSync(path)) }],
  });
  return compiler;
}

function addressLines(address: Address): string[] {
  const lines = [address.strasse, `${address.plz} ${address.ort}`];
  if (address.land.toUpperCase() !== "DE") lines.push(countryName(address.land).toUpperCase());
  return lines;
}

/** Druckfertige Texte für das Typst-Template; formatiert wird ausschließlich hier. */
export function pdfData(doc: InvoiceDocument) {
  const { seller, buyer } = doc;
  const title = TITLES[doc.kind];

  const meta = [
    { label: "Rechnungsnummer", value: doc.number },
    { label: "Rechnungsdatum", value: formatDate(doc.issueDate) },
  ];
  if (doc.serviceFrom && doc.serviceTo && doc.serviceFrom !== doc.serviceTo) {
    meta.push({ label: "Leistungszeitraum", value: `${formatDate(doc.serviceFrom)} – ${formatDate(doc.serviceTo)}` });
  } else {
    const date = doc.serviceFrom ?? doc.serviceTo;
    meta.push({ label: "Leistungsdatum", value: date ? formatDate(date) : "entspricht Rechnungsdatum" });
  }
  if (buyer.kundennummer) meta.push({ label: "Kundennummer", value: buyer.kundennummer });
  if (buyer.leitwegId) meta.push({ label: "Leitweg-ID", value: buyer.leitwegId });
  // Bei Reverse Charge ist die USt-IdNr. des Kunden Pflichtangabe (§ 14a Abs. 1 UStG)
  if (buyer.ustId) meta.push({ label: "Ihre USt-IdNr.", value: buyer.ustId });

  const treatment = doc.taxTreatment ?? "regulaer";
  const multipleRates = doc.totals.taxes.length > 1;
  // Ohne Steuerausweis (Kleinunternehmer, Reverse Charge usw.) keine Zeile „Umsatzsteuer 0 %“
  const taxRows = (treatment === "regulaer" ? doc.totals.taxes : []).map((t) => ({
    label: multipleRates ? `Umsatzsteuer ${formatRate(t.rate)} auf ${formatEuro(t.base)}` : `Umsatzsteuer ${formatRate(t.rate)}`,
    value: formatEuro(t.tax),
  }));

  const contact = [seller.name, ...addressLines(seller), seller.email];
  if (seller.telefon) contact.push(`Tel. ${seller.telefon}`);
  const bank: string[] = [];
  if (seller.bank) bank.push(seller.bank);
  if (seller.iban) bank.push(`IBAN ${formatIban(seller.iban)}`);
  if (seller.bic) bank.push(`BIC ${seller.bic}`);
  const tax: string[] = [];
  if (seller.steuernummer) tax.push(`Steuernummer ${seller.steuernummer}`);
  if (seller.ustId) tax.push(`USt-IdNr. ${seller.ustId}`);

  return {
    docTitle: `${title} ${doc.number}`,
    author: seller.name,
    title,
    reference: doc.corrects ? `zur Rechnung ${doc.corrects.number} vom ${formatDate(doc.corrects.issueDate)}` : null,
    senderLine: [seller.name, seller.strasse, `${seller.plz} ${seller.ort}`].join(" · "),
    recipient: [buyer.name, ...addressLines(buyer)],
    meta,
    lines: doc.lines.map((line) => ({
      pos: String(line.position),
      description: line.description,
      quantity: `${formatQuantity(line.quantity)} ${line.unit}`,
      unitPrice: formatEuro(line.unitPrice),
      rate: treatment === "regulaer" ? formatRate(line.taxRate) : "–",
      net: formatEuro(line.net),
    })),
    totals: {
      rows: [{ label: "Summe netto", value: formatEuro(doc.totals.net) }, ...taxRows],
      gross: { label: "Gesamtbetrag", value: formatEuro(doc.totals.gross) },
    },
    payment: paymentSentence(doc),
    taxNote: treatmentNote(treatment, doc.exemptionReason),
    note: doc.note?.trim() ? doc.note.trim() : null,
    footer: [contact, bank, tax],
  };
}

/** Sichtbare Rechnung als PDF/A-3b (Grundlage für ZUGFeRD). */
export function renderInvoicePdf(doc: InvoiceDocument): Uint8Array {
  const typst = getCompiler();
  const result = typst.compile({ mainFilePath: TEMPLATE, inputs: { data: JSON.stringify(pdfData(doc)) } });
  const document = result.result;
  if (result.hasError() || !document) {
    const error = result.takeError();
    const diagnostics = error ? typst.fetchDiagnostics(error) : [];
    throw new Error(`Rechnungs-PDF konnte nicht erzeugt werden: ${JSON.stringify(diagnostics)}`);
  }
  const pdf = typst.pdf(document, { pdfStandard: "a-3b", creationTimestamp: Math.floor(Date.parse(`${doc.issueDate}T12:00:00Z`) / 1000) });
  typst.evictCache(10);
  return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
}
