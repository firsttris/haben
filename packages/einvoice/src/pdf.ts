import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { accountHolder, countryName, formatIban, paymentSentence, referenceMeta } from "./format.ts";
import { texts, TEXTS, type Texts } from "./i18n.ts";
import { girocodeSvg } from "./qr.ts";
import {
  accentPalette,
  DEFAULT_ACCENT,
  discountedLineAmount,
  documentAllowances,
  lineAmount,
  lineDiscountAmount,
  type Discount,
  type LegalInfo,
} from "@haben/core";
import type { Address, InvoiceDocument, InvoiceDocumentLine, Letterhead, Logo } from "./types.ts";

// Paketverzeichnis mit templates/ und fonts/; im gebündelten Server per HABEN_EINVOICE_DIR gesetzt.
const PACKAGE_DIR = process.env.HABEN_EINVOICE_DIR ?? fileURLToPath(new URL("..", import.meta.url));
const TEMPLATE = join(PACKAGE_DIR, "templates", "rechnung.typ");
const DUNNING_TEMPLATE = join(PACKAGE_DIR, "templates", "mahnung.typ");
const STEUERBESCHEINIGUNG_TEMPLATE = join(PACKAGE_DIR, "templates", "steuerbescheinigung.typ");
const HINTERLEGUNG_TEMPLATE = join(PACKAGE_DIR, "templates", "hinterlegung.typ");
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

/** Spaltenköpfe und Seitenzahl für das Template; bei Bruttopreisen steht in der letzten Spalte der Bruttobetrag */
export function templateLabels(t: Texts, gross = false) {
  return {
    columns: gross ? { ...t.columns, net: t.grossColumn } : t.columns,
    page: t
      .page("#", "#")
      .split("#")
      .map((part) => part.trim()),
  };
}

/** Bruttopreise gibt es nur bei regulärer Besteuerung; ohne Steuerausweis sind netto und brutto gleich */
export function showsGrossPrices(doc: Pick<InvoiceDocument, "taxTreatment" | "priceMode">): boolean {
  return (doc.taxTreatment ?? "regulaer") === "regulaer" && doc.priceMode === "brutto";
}

/** Rabatt als Text: „10 %“ bzw. „49,00 €“ */
const discountText = (discount: Discount, t: Texts) => (discount.kind === "prozent" ? t.percent(discount.value) : t.money(Math.abs(discount.value)));

/** Abzug als Text mit Minus; bei Storno und Korrektur (negativer Abzug) ohne */
const minus = (value: number, t: Texts) => (value >= 0 ? `\u2212${t.money(value)}` : t.money(-value));

/** „abzüglich 10 % Rabatt (1.444,00 €)“ unter der Bezeichnung; null ohne Positionsrabatt */
function lineDiscountText(line: InvoiceDocument["lines"][number], t: Texts): string | null {
  if (!line.discount) return null;
  const amount = Math.abs(lineDiscountAmount(lineAmount(line.quantity, line.unitPrice), line.discount));
  return t.lineDiscount(discountText(line.discount, t), line.discount.kind === "prozent" ? t.money(amount) : null);
}

/**
 * Gesamtrabatt in den Summen: Zwischensumme der Positionen und der Abzug, im Preismodus des Belegs; leer ohne Rabatt.
 * Die Beträge folgen aus Zeilennetto und Steuerzeilen (documentAllowances), wie in der E-Rechnung.
 */
function documentDiscountRows(doc: Pick<InvoiceDocument, "lines" | "totals" | "discount">, gross: boolean, t: Texts) {
  if (!doc.discount) return [];
  const allowances = documentAllowances(doc.lines, doc.totals, gross ? "brutto" : "netto");
  if (allowances.length === 0) return [];
  const subtotal = doc.lines.reduce((s, l) => s + (gross ? discountedLineAmount(l) : l.net), 0);
  const reduction = allowances.reduce((s, a) => s + a.amount, 0);
  return [
    { label: t.subtotal, value: t.money(subtotal) },
    { label: t.documentDiscount(doc.discount.kind === "prozent" ? discountText(doc.discount, t) : null), value: minus(reduction, t) },
  ];
}

/** Spalte „Art.-Nr.“ (BT-155) nur, wenn mindestens eine Position eine Artikelnummer hat; sonst bleibt die Tabelle wie bisher */
export function itemNumberColumn(lines: Pick<InvoiceDocumentLine, "itemNumber">[]): { itemNumbers: boolean } {
  return { itemNumbers: lines.some((line) => Boolean(line.itemNumber?.trim())) };
}

/** Gemeinsamer Teil von Rechnung und Angebot: Adressen, Positionen, Summenzeilen, Hinweise, Fußzeile */
export function documentPdfData(
  doc: Pick<InvoiceDocument, "seller" | "buyer" | "lines" | "totals" | "taxTreatment" | "exemptionReason" | "intro" | "note" | "priceMode" | "discount">,
  t: Texts,
) {
  const { seller, buyer } = doc;
  const treatment = doc.taxTreatment ?? "regulaer";
  const gross = showsGrossPrices(doc);
  const multipleRates = doc.totals.taxes.length > 1;
  // Ohne Steuerausweis (Kleinunternehmer, Reverse Charge usw.) keine Zeile „Umsatzsteuer 0 %“
  const taxes = treatment === "regulaer" ? doc.totals.taxes : [];
  const taxRows = taxes.map((tax) => ({
    label: t.vat(t.rate(tax.rate), multipleRates ? t.money(tax.base) : undefined),
    value: t.money(tax.tax),
  }));
  // Bruttopreise: unter dem Gesamtbetrag „darin enthalten“ Netto und Umsatzsteuer je Satz (§ 14 Abs. 4 Nr. 7 und 8 UStG)
  const includedRows = taxes.flatMap((tax) => [
    { label: t.includedNet(multipleRates ? t.rate(tax.rate) : undefined), value: t.money(tax.base) },
    { label: t.vat(t.rate(tax.rate)), value: t.money(tax.tax) },
  ]);
  return {
    author: seller.name,
    labels: templateLabels(t, gross),
    senderLine: [seller.name, seller.strasse, `${seller.plz} ${seller.ort}`].join(" · "),
    recipient: [buyer.name, ...addressLines(buyer, t)],
    ...itemNumberColumn(doc.lines),
    lines: doc.lines.map((line) => ({
      pos: String(line.position),
      itemNumber: line.itemNumber?.trim() ?? "",
      description: line.description,
      detail: line.detail?.trim() ? line.detail.trim() : null,
      quantity: t.quantity(line.quantity, line.unit),
      unitPrice: t.money(line.unitPrice),
      rate: treatment === "regulaer" ? t.rate(line.taxRate) : "–",
      net: t.money(gross ? discountedLineAmount(line) : line.net),
      discount: lineDiscountText(line, t),
    })),
    totalRows: [...documentDiscountRows(doc, gross, t), ...(gross ? [] : [{ label: t.totalNet, value: t.money(doc.totals.net) }, ...taxRows])],
    included: gross ? { label: t.included, rows: includedRows } : null,
    grossLabel: (label: string) => (gross ? t.inclVat(label) : label),
    taxNote: t.note(treatment, doc.exemptionReason),
    intro: doc.intro?.trim() ? doc.intro.trim() : null,
    note: doc.note?.trim() ? doc.note.trim() : null,
    ...footerData(seller, t),
  };
}

/** Druckfertige Texte für das Typst-Template; formatiert wird ausschließlich hier. */
export function pdfData(doc: InvoiceDocument) {
  const { seller, buyer } = doc;
  const t = texts(doc.language, doc.currency);
  const title = doc.kind === "rechnung" && doc.variant ? t.variants[doc.variant] : t.titles[doc.kind];

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
  meta.push(...referenceMeta(doc.references, t));
  if (buyer.leitwegId) meta.push({ label: t.leitwegId, value: buyer.leitwegId });
  // Bei Reverse Charge ist die USt-IdNr. des Kunden Pflichtangabe (§ 14a Abs. 1 UStG)
  if (buyer.ustId) meta.push({ label: t.buyerVatId, value: buyer.ustId });

  const { totalRows, included, grossLabel, ...body } = documentPdfData(doc, t);
  // Fremdwährung: die Umsatzsteuer zusätzlich in Euro (§ 14 Abs. 4 Nr. 8 UStG, Abschn. 14.5 UStAE)
  const euroTax = doc.euroTax
    ? {
        label: t.inEuro(doc.euroTax.rate),
        rows: [
          ...doc.euroTax.taxes.map((tax) => ({ label: t.vatInEuro(t.rate(tax.rate)), value: t.euro(tax.tax) })),
          ...(doc.euroTax.taxes.length > 1 ? [{ label: t.vatTotal, value: t.euro(doc.euroTax.tax) }] : []),
        ],
      }
    : null;
  return {
    ...body,
    docTitle: `${title} ${doc.number}`,
    title,
    reference: doc.corrects ? t.reference(doc.corrects.number, t.date(doc.corrects.issueDate)) : null,
    meta,
    totals: { rows: totalRows, gross: { label: grossLabel(t.totalGross), value: t.money(doc.totals.gross) }, included, euroTax },
    payment: paymentSentence(doc, t),
    // GiroCode nur für Rechnungen mit Zahlbetrag in Euro und Konto des Verkäufers (SEPA kennt nur Euro)
    qr:
      doc.kind === "rechnung" && doc.currency === "EUR" && doc.totals.gross > 0 && seller.iban
        ? girocodeSvg({
            name: accountHolder(seller),
            iban: seller.iban,
            ...(seller.bic ? { bic: seller.bic } : {}),
            amount: doc.totals.gross,
            text: t.girocodeText(doc.number),
          })
        : null,
  };
}

/** Sichtbare Rechnung als PDF/A-3b (Grundlage für ZUGFeRD). */
export function renderInvoicePdf(doc: InvoiceDocument): Uint8Array {
  return compilePdf(TEMPLATE, pdfData(doc), doc.issueDate, "Rechnungs-PDF", doc);
}

/** Entwurfs-PDF und sein Dateiname */
export interface DraftPdf {
  pdf: Uint8Array;
  filename: string;
}

/**
 * Daten der Vorlage als Entwurf (Issue #342): „ENTWURF“ über jeder Seite (templates/entwurf.typ), statt des GiroCodes
 * ein Platzhalter gleicher Größe, damit niemand einen Entwurf bezahlt
 */
export function asDraft<T extends object>(data: T & { qr?: string | null }, t: Pick<Texts, "draft">) {
  return { ...data, qr: null, draft: t.draft.mark, qrPlaceholder: data.qr ? t.draft.girocode : null };
}

/** Dateiname eines Entwurfs, z. B. „Rechnung-Entwurf-2026-10-02.pdf“ oder „Invoice-Draft-2026-10-02.pdf“ */
export function draftFilename(title: string, date: string, t: Pick<Texts, "draft">): string {
  return `${title.replace(/\s+/g, "-")}-${t.draft.file}-${date}.pdf`;
}

/**
 * Rechnungsentwurf als PDF/A-3b aus derselben Vorlage wie die festgeschriebene Rechnung, ohne eingebettetes XML;
 * statt der Nummer steht „ENTWURF“ im Kopf
 */
export function renderInvoiceDraftPdf(doc: Omit<InvoiceDocument, "number">): DraftPdf {
  const t = texts(doc.language, doc.currency);
  const data = pdfData({ ...doc, number: t.draft.mark });
  return { pdf: compilePdf(TEMPLATE, asDraft(data, t), doc.issueDate, "Entwurfs-PDF", doc), filename: draftFilename(data.title, doc.issueDate, t) };
}

/** Angebot als PDF/A-3b; die Daten kommen fertig formatiert aus quotePdfData */
export function renderQuotePdfData(data: object, date: string, letterhead: Letterhead): Uint8Array {
  return compilePdf(TEMPLATE, data, date, "Angebots-PDF", letterhead);
}

/** Mahnung als PDF/A-3b; die Daten kommen fertig formatiert aus dunningPdfData */
export function renderDunningPdf(data: object, date: string, letterhead: Letterhead): Uint8Array {
  return compilePdf(DUNNING_TEMPLATE, data, date, "Mahnungs-PDF", letterhead);
}

/** Steuerbescheinigung als PDF/A-3b; die Daten kommen fertig formatiert aus steuerbescheinigungPdfData */
export function renderSteuerbescheinigungPdf(data: object, date: string, letterhead: Letterhead): Uint8Array {
  return compilePdf(STEUERBESCHEINIGUNG_TEMPLATE, data, date, "Steuerbescheinigung", letterhead);
}

/** Bilanz zur Hinterlegung als PDF/A-3b, ohne Logo und Akzentfarbe; die Daten kommen aus hinterlegungPdfData */
export function renderHinterlegungPdf(data: object, date: string): Uint8Array {
  return compilePdf(HINTERLEGUNG_TEMPLATE, data, date, "Bilanz-PDF", {});
}

/** Entgeltabrechnung und Lohnkonto als PDF/A-3b; die Daten kommen fertig formatiert aus lohnabrechnungPdfData bzw. lohnkontoPdfData */
export function renderLohnPdf(
  template: "lohnabrechnung.typ" | "lohnkonto.typ" | "lohnsteuerbescheinigung.typ",
  data: object,
  date: string,
  label: string,
  letterhead: Letterhead,
): Uint8Array {
  return compilePdf(join(PACKAGE_DIR, "templates", template), data, date, label, letterhead);
}

/** Fußzeile wie auf der Rechnung: Kontakt, Bank, Steuernummern */
export function footerColumns(seller: InvoiceDocument["seller"], t: Texts = TEXTS.de): string[][] {
  const contact = [seller.name, ...addressLines(seller, t), seller.email];
  if (seller.telefon) contact.push(`${t.phone} ${seller.telefon}`);
  const bank: string[] = [];
  if (seller.bank) bank.push(seller.bank);
  if (accountHolder(seller) !== seller.name) bank.push(`${t.accountHolder} ${accountHolder(seller)}`);
  if (seller.iban) bank.push(`IBAN ${formatIban(seller.iban)}`);
  if (seller.bic) bank.push(`BIC ${seller.bic}`);
  const tax: string[] = [];
  if (seller.steuernummer) tax.push(`${t.taxNumber} ${seller.steuernummer}`);
  if (seller.ustId) tax.push(`${t.vatId} ${seller.ustId}`);
  return [contact, bank, tax];
}

/** Pflichtangaben einer GmbH oder UG (§ 35a Abs. 1 GmbHG), je Angabe ein Text; leer ohne Angaben */
export function legalLines(info: LegalInfo | undefined, t: Texts = TEXTS.de): string[] {
  if (!info) return [];
  const { legal } = t;
  const register = [info.registerCourt, info.registerNumber].filter(Boolean).join(", ");
  return [
    info.legalForm ? `${legal.legalForm}: ${info.legalForm}` : "",
    info.seat ? `${legal.seat}: ${info.seat}` : "",
    // Ohne Gericht steht die Nummer für sich, z. B. „HRB 12345 HB“
    info.registerCourt ? `${legal.registerCourt}: ${register}` : register,
    info.managingDirectors.length > 0 ? `${legal.managingDirectors}: ${info.managingDirectors.join(", ")}` : "",
    info.supervisoryBoardChair ? `${legal.supervisoryBoardChair}: ${info.supervisoryBoardChair}` : "",
  ].filter(Boolean);
}

/**
 * Die Pflichtangaben als eine Zeile über die ganze Breite unter den Spalten des Fußes; null ohne Angaben, dann bleibt
 * der Fuß wie beim Einzelunternehmen.
 */
export function legalLine(info: LegalInfo | undefined, t: Texts = TEXTS.de): string | null {
  const lines = legalLines(info, t);
  return lines.length > 0 ? lines.join(" · ") : null;
}

/** Fuß für die Vorlagen: drei Spalten und die Pflichtangaben der Gesellschaft */
export function footerData(seller: InvoiceDocument["seller"], t: Texts = TEXTS.de) {
  return { footer: footerColumns(seller, t), legal: legalLine(seller.legalInfo, t) };
}

/** Erkennt PNG und JPEG an den ersten Bytes; anderes lehnt Haben als Logo ab */
export function logoFormat(data: Uint8Array): Logo["format"] | null {
  if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  return null;
}

/** Daten für die Vorlage mit dem Briefkopf: Akzentfarbe und passende Grautöne immer, das Logo als Dateiname neben der Vorlage */
export function templateInputs(data: object, { logo, accent = DEFAULT_ACCENT }: Letterhead): object {
  return { ...data, accent, palette: accentPalette(accent), ...(logo ? { logo: `logo.${logo.format}` } : {}) };
}

function compilePdf(template: string, data: object, date: string, label: string, letterhead: Letterhead): Uint8Array {
  const typst = getCompiler();
  const { logo } = letterhead;
  // Das Logo liegt nur für diesen Lauf als Datei neben der Vorlage
  const logoPath = logo ? join(PACKAGE_DIR, "templates", `logo.${logo.format}`) : null;
  if (logo && logoPath) typst.mapShadow(logoPath, Buffer.from(logo.data));
  try {
    return compileWith(typst, template, templateInputs(data, letterhead), date, label);
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
