import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { countryName, formatIban } from "./format.ts";
import { texts, TEXTS, type Texts } from "./i18n.ts";
import { girocodeSvg } from "./qr.ts";
import type { Address, InvoiceDocument, Logo } from "./types.ts";

// Paketverzeichnis mit templates/ und fonts/; im gebündelten Server per HABEN_EINVOICE_DIR gesetzt.
const PACKAGE_DIR = process.env.HABEN_EINVOICE_DIR ?? fileURLToPath(new URL("..", import.meta.url));
const TEMPLATE = join(PACKAGE_DIR, "templates", "rechnung.typ");
const DUNNING_TEMPLATE = join(PACKAGE_DIR, "templates", "mahnung.typ");
const FONTS = ["Regular", "Medium", "SemiBold"].map((weight) => join(PACKAGE_DIR, "fonts", `IBMPlexSans-${weight}.ttf`));

let compiler: NodeCompiler | undefined;

function getCompiler(): NodeCompiler {
  compiler ??= NodeCompiler.create({
    workspace: join(PACKAGE_DIR, "templates"),
    fontArgs: [{ fontBlobs: FONTS.map((path) => readFileSync(path)) }],
  });
  return compiler;
}

export function addressLines(address: Address, t: Texts = TEXTS.de): string[] {
  const lines = [address.strasse, `${address.plz} ${address.ort}`];
  if (address.land.toUpperCase() !== "DE") lines.push(countryName(address.land, t.countryLocale).toUpperCase());
  return lines;
}

/** Spaltenköpfe und Seitenzahl für das Template */
export function templateLabels(t: Texts) {
  return { columns: t.columns, page: t.page("#", "#").split("#").map((part) => part.trim()) };
}

/** Druckfertige Texte für das Typst-Template; formatiert wird ausschließlich hier. */
export function pdfData(doc: InvoiceDocument) {
  const { seller, buyer } = doc;
  const t = texts(doc.language);
  const title = t.titles[doc.kind];

  const meta: { label: string; value: string }[] = [
    { label: t.invoiceNumber, value: doc.number },
    { label: t.invoiceDate, value: t.date(doc.issueDate) },
  ];
  if (doc.serviceFrom && doc.serviceTo && doc.serviceFrom !== doc.serviceTo) {
    meta.push({ label: t.servicePeriod, value: `${t.date(doc.serviceFrom)} – ${t.date(doc.serviceTo)}` });
  } else {
    const date = doc.serviceFrom ?? doc.serviceTo;
    meta.push({ label: t.serviceDate, value: date ? t.date(date) : t.serviceDateDefault });
  }
  if (buyer.kundennummer) meta.push({ label: t.customerNumber, value: buyer.kundennummer });
  if (buyer.leitwegId) meta.push({ label: t.leitwegId, value: buyer.leitwegId });
  // Bei Reverse Charge ist die USt-IdNr. des Kunden Pflichtangabe (§ 14a Abs. 1 UStG)
  if (buyer.ustId) meta.push({ label: t.buyerVatId, value: buyer.ustId });

  const treatment = doc.taxTreatment ?? "regulaer";
  const multipleRates = doc.totals.taxes.length > 1;
  // Ohne Steuerausweis (Kleinunternehmer, Reverse Charge usw.) keine Zeile „Umsatzsteuer 0 %“
  const taxRows = (treatment === "regulaer" ? doc.totals.taxes : []).map((tax) => ({
    label: t.vat(t.rate(tax.rate), multipleRates ? t.money(tax.base) : undefined),
    value: t.money(tax.tax),
  }));
  const payment = doc.totals.gross < 0 ? t.refund : doc.totals.gross === 0 ? t.noPayment : t.payBy(t.date(doc.dueDate));

  return {
    docTitle: `${title} ${doc.number}`,
    author: seller.name,
    title,
    labels: templateLabels(t),
    reference: doc.corrects ? t.reference(doc.corrects.number, t.date(doc.corrects.issueDate)) : null,
    senderLine: [seller.name, seller.strasse, `${seller.plz} ${seller.ort}`].join(" · "),
    recipient: [buyer.name, ...addressLines(buyer, t)],
    meta,
    lines: doc.lines.map((line) => ({
      pos: String(line.position),
      description: line.description,
      quantity: t.quantity(line.quantity, line.unit),
      unitPrice: t.money(line.unitPrice),
      rate: treatment === "regulaer" ? t.rate(line.taxRate) : "–",
      net: t.money(line.net),
    })),
    totals: {
      rows: [{ label: t.totalNet, value: t.money(doc.totals.net) }, ...taxRows],
      gross: { label: t.totalGross, value: t.money(doc.totals.gross) },
    },
    payment,
    // GiroCode nur für Rechnungen mit Zahlbetrag und Konto des Verkäufers
    qr:
      doc.kind === "rechnung" && doc.totals.gross > 0 && seller.iban
        ? girocodeSvg({ name: seller.name, iban: seller.iban, ...(seller.bic ? { bic: seller.bic } : {}), amount: doc.totals.gross, text: t.girocodeText(doc.number) })
        : null,
    taxNote: t.note(treatment, doc.exemptionReason),
    note: doc.note?.trim() ? doc.note.trim() : null,
    footer: footerColumns(seller, t),
  };
}

/** Sichtbare Rechnung als PDF/A-3b (Grundlage für ZUGFeRD). */
export function renderInvoicePdf(doc: InvoiceDocument): Uint8Array {
  return compilePdf(TEMPLATE, pdfData(doc), doc.issueDate, "Rechnungs-PDF", doc.logo);
}

/** Angebot als PDF/A-3b; die Daten kommen fertig formatiert aus quotePdfData */
export function renderQuotePdfData(data: unknown, date: string, logo?: Logo): Uint8Array {
  return compilePdf(TEMPLATE, data, date, "Angebots-PDF", logo);
}

/** Mahnung als PDF/A-3b; die Daten kommen fertig formatiert aus dunningPdfData */
export function renderDunningPdf(data: unknown, date: string, logo?: Logo): Uint8Array {
  return compilePdf(DUNNING_TEMPLATE, data, date, "Mahnungs-PDF", logo);
}

/** Fußzeile wie auf der Rechnung: Kontakt, Bank, Steuernummern */
export function footerColumns(seller: InvoiceDocument["seller"], t: Texts = TEXTS.de): string[][] {
  const contact = [seller.name, ...addressLines(seller, t), seller.email];
  if (seller.telefon) contact.push(`${t.phone} ${seller.telefon}`);
  const bank: string[] = [];
  if (seller.bank) bank.push(seller.bank);
  if (seller.iban) bank.push(`IBAN ${formatIban(seller.iban)}`);
  if (seller.bic) bank.push(`BIC ${seller.bic}`);
  const tax: string[] = [];
  if (seller.steuernummer) tax.push(`${t.taxNumber} ${seller.steuernummer}`);
  if (seller.ustId) tax.push(`${t.vatId} ${seller.ustId}`);
  return [contact, bank, tax];
}

/** Erkennt PNG und JPEG an den ersten Bytes; anderes lehnt Haben als Logo ab */
export function logoFormat(data: Uint8Array): Logo["format"] | null {
  if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  return null;
}

function compilePdf(template: string, data: unknown, date: string, label: string, logo?: Logo): Uint8Array {
  const typst = getCompiler();
  // Das Logo liegt nur für diesen Lauf als Datei neben der Vorlage
  const logoPath = logo ? join(PACKAGE_DIR, "templates", `logo.${logo.format}`) : null;
  if (logo && logoPath) typst.mapShadow(logoPath, Buffer.from(logo.data));
  try {
    return compileWith(typst, template, logo ? { ...(data as object), logo: `logo.${logo.format}` } : data, date, label);
  } finally {
    if (logoPath) typst.unmapShadow(logoPath);
  }
}

function compileWith(typst: NodeCompiler, template: string, data: unknown, date: string, label: string): Uint8Array {
  const result = typst.compile({ mainFilePath: template, inputs: { data: JSON.stringify(data) } });
  const document = result.result;
  if (result.hasError() || !document) {
    const error = result.takeError();
    const diagnostics = error ? typst.fetchDiagnostics(error) : [];
    throw new Error(`${label} konnte nicht erzeugt werden: ${JSON.stringify(diagnostics)}`);
  }
  const pdf = typst.pdf(document, { pdfStandard: "a-3b", creationTimestamp: Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000) });
  typst.evictCache(10);
  return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
}
