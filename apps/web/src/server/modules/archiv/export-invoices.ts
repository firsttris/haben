import { formatExchangeRate } from "@haben/core";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { loadFile } from "../../storage.ts";
import { csv, type CsvValue, iso, money } from "./csv.ts";
import { safeName, uniquePath } from "./export-paths.ts";
import type { ArchiveFile } from "./export-zip.ts";
import { yearEnd, yearStart } from "./jahr.ts";

// Rechnungen und Angebote des Jahresarchivs, jeweils mit ihren Anhängen

const encoder = new TextEncoder();

const KIND_LABELS: Record<string, string> = {
  rechnung: "Rechnung",
  storno: "Stornorechnung",
  korrektur: "Rechnungskorrektur",
  abschlag: "Abschlagsrechnung",
  schluss: "Schlussrechnung",
};
const FORMAT_LABELS: Record<string, string> = { zugferd: "ZUGFeRD", "xrechnung-cii": "XRechnung (CII)", "xrechnung-ubl": "XRechnung (UBL)" };

/** Festgeschriebene Rechnungen des Jahres; gibt die Rechnungsnummern je ID zurück, die spätere Teile des Archivs ergänzen */
export async function* invoiceFiles(year: number, problems: string[]): AsyncGenerator<ArchiveFile, Map<string, string | null>> {
  const invoices = await invoicesOfYear(year);

  const referenced = [...new Set(invoices.map((i) => i.correctsId).filter((id): id is string => id !== null))];
  const invoiceNumbers = new Map<string, string | null>(invoices.map((i) => [i.id, i.number]));
  if (referenced.length > 0) {
    for (const row of await db
      .select({ id: schema.invoices.id, number: schema.invoices.number })
      .from(schema.invoices)
      .where(inArray(schema.invoices.id, referenced))) {
      invoiceNumbers.set(row.id, row.number);
    }
  }

  const usedInvoicePaths = new Set<string>();
  const invoiceRows: CsvValue[][] = [];
  for (const invoice of invoices) {
    const [files] = await db.select({ pdf: schema.invoices.pdf, xml: schema.invoices.xml }).from(schema.invoices).where(eq(schema.invoices.id, invoice.id));
    const stem = `rechnungen/${safeName(invoice.number ?? invoice.id, 60)}`;
    let pdfPath = "";
    let xmlPath = "";
    if (files?.pdf) {
      pdfPath = uniquePath(usedInvoicePaths, `${stem}.pdf`);
      yield { path: pdfPath, content: new Uint8Array(files.pdf), compress: false };
    }
    if (files?.xml) {
      xmlPath = uniquePath(usedInvoicePaths, `${stem}.xml`);
      yield { path: xmlPath, content: encoder.encode(files.xml), compress: true };
    }
    invoiceRows.push(invoiceRow(invoice, invoiceNumbers, pdfPath, xmlPath));
  }
  yield {
    path: "rechnungen/rechnungen.csv",
    content: csv(
      [
        "Nummer",
        "Art",
        "Datum",
        "Fällig",
        "Leistung von",
        "Leistung bis",
        "Kunde",
        "Netto",
        "USt",
        "Brutto",
        "Währung",
        "Kurs (1 EUR =)",
        "Format",
        "Festgeschrieben",
        "SHA-256 PDF",
        "SHA-256 XML",
        "Storno/Korrektur von",
        "Datei PDF",
        "Datei XML",
        "ID",
      ],
      invoiceRows,
    ),
    compress: true,
  };
  yield* attachmentArchive(INVOICE_ATTACHMENTS, await invoiceAttachmentRows(invoices), problems);
  return invoiceNumbers;
}

async function invoicesOfYear(year: number) {
  return db
    .select({
      id: schema.invoices.id,
      kind: schema.invoices.kind,
      number: schema.invoices.number,
      issueDate: schema.invoices.issueDate,
      dueDate: schema.invoices.dueDate,
      serviceFrom: schema.invoices.serviceFrom,
      serviceTo: schema.invoices.serviceTo,
      buyer: schema.invoices.buyer,
      net: schema.invoices.net,
      tax: schema.invoices.tax,
      gross: schema.invoices.gross,
      currency: schema.invoices.currency,
      exchangeRate: schema.invoices.exchangeRate,
      format: schema.invoices.format,
      lockedAt: schema.invoices.lockedAt,
      pdfSha256: schema.invoices.pdfSha256,
      xmlSha256: schema.invoices.xmlSha256,
      correctsId: schema.invoices.correctsId,
      variant: schema.invoices.variant,
    })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.status, "final"), gte(schema.invoices.issueDate, yearStart(year)), lte(schema.invoices.issueDate, yearEnd(year))))
    .orderBy(asc(schema.invoices.issueDate), asc(schema.invoices.number));
}

/** Zeile der rechnungen.csv */
function invoiceRow(
  invoice: Awaited<ReturnType<typeof invoicesOfYear>>[number],
  invoiceNumbers: Map<string, string | null>,
  pdfPath: string,
  xmlPath: string,
): CsvValue[] {
  return [
    invoice.number,
    KIND_LABELS[invoice.variant ?? invoice.kind] ?? invoice.kind,
    invoice.issueDate,
    invoice.dueDate,
    invoice.serviceFrom,
    invoice.serviceTo,
    invoice.buyer?.name ?? "",
    money(invoice.net),
    money(invoice.tax),
    money(invoice.gross),
    invoice.currency,
    invoice.exchangeRate ? formatExchangeRate(invoice.exchangeRate) : null,
    FORMAT_LABELS[invoice.format] ?? invoice.format,
    iso(invoice.lockedAt),
    invoice.pdfSha256,
    invoice.xmlSha256,
    invoice.correctsId ? (invoiceNumbers.get(invoice.correctsId) ?? invoice.correctsId) : "",
    pdfPath.replace(/^rechnungen\//, ""),
    xmlPath.replace(/^rechnungen\//, ""),
    invoice.id,
  ];
}

/** Angebote (Handelsbriefe, nur wenn vorhanden) */
export async function* quoteFiles(year: number, problems: string[]): AsyncGenerator<ArchiveFile> {
  const quotes = await db
    .select({
      id: schema.quotes.id,
      number: schema.quotes.number,
      issueDate: schema.quotes.issueDate,
      validUntil: schema.quotes.validUntil,
      buyer: schema.quotes.buyer,
      net: schema.quotes.net,
      tax: schema.quotes.tax,
      gross: schema.quotes.gross,
      decision: schema.quotes.decision,
      invoiceNumber: schema.invoices.number,
      lockedAt: schema.quotes.lockedAt,
      pdfSha256: schema.quotes.pdfSha256,
    })
    .from(schema.quotes)
    .leftJoin(schema.invoices, eq(schema.invoices.id, schema.quotes.invoiceId))
    .where(and(eq(schema.quotes.status, "final"), gte(schema.quotes.issueDate, yearStart(year)), lte(schema.quotes.issueDate, yearEnd(year))))
    .orderBy(asc(schema.quotes.issueDate), asc(schema.quotes.number));
  if (quotes.length > 0) {
    const usedQuotePaths = new Set<string>();
    const quoteRows: CsvValue[][] = [];
    for (const quote of quotes) {
      const [file] = await db.select({ pdf: schema.quotes.pdf }).from(schema.quotes).where(eq(schema.quotes.id, quote.id));
      let pdfPath = "";
      if (file?.pdf) {
        pdfPath = uniquePath(usedQuotePaths, `angebote/${safeName(quote.number ?? quote.id, 60)}.pdf`);
        yield { path: pdfPath, content: new Uint8Array(file.pdf), compress: false };
      }
      quoteRows.push([
        quote.number,
        quote.issueDate,
        quote.validUntil,
        quote.buyer?.name ?? "",
        money(quote.net),
        money(quote.tax),
        money(quote.gross),
        quote.decision ?? "",
        quote.invoiceNumber ?? "",
        iso(quote.lockedAt),
        quote.pdfSha256,
        pdfPath.replace(/^angebote\//, ""),
        quote.id,
      ]);
    }
    yield {
      path: "angebote/angebote.csv",
      content: csv(
        ["Nummer", "Datum", "Gültig bis", "Kunde", "Netto", "USt", "Brutto", "Antwort", "Rechnung", "Festgeschrieben", "SHA-256 PDF", "Datei PDF", "ID"],
        quoteRows,
      ),
      compress: true,
    };
    yield* attachmentArchive(QUOTE_ATTACHMENTS, await quoteAttachmentRows(quotes), problems);
  }
}

type AttachmentRow = { id: string; ownerNumber: string; filename: string; size: number; sha256: string };

/** Wo die Anhänge einer Belegart im Archiv liegen und wie die Spalte des Belegs in anhaenge.csv heißt */
type AttachmentArchive = { dir: string; noun: string; of: string };
const INVOICE_ATTACHMENTS: AttachmentArchive = { dir: "rechnungen/anhaenge", noun: "Rechnung", of: "der Rechnung" };
const QUOTE_ATTACHMENTS: AttachmentArchive = { dir: "angebote/anhaenge", noun: "Angebot", of: "des Angebots" };

/** Anhänge der Rechnungen des Archivs (#272), in der Reihenfolge, in der sie angehängt wurden */
async function invoiceAttachmentRows(invoices: { id: string; number: string | null }[]): Promise<AttachmentRow[]> {
  if (invoices.length === 0) return [];
  const t = schema.invoiceAttachments;
  const numbers = new Map(invoices.map((i) => [i.id, i.number ?? i.id]));
  const rows = await db
    .select()
    .from(t)
    .where(inArray(t.invoiceId, [...numbers.keys()]))
    .orderBy(asc(t.createdAt), asc(t.id));
  return rows.map((a) => ({ ...a, ownerNumber: numbers.get(a.invoiceId)! }));
}

/** Anhänge der festgeschriebenen Angebote des Archivs (#415) */
async function quoteAttachmentRows(quotes: { id: string; number: string | null }[]): Promise<AttachmentRow[]> {
  if (quotes.length === 0) return [];
  const t = schema.quoteAttachments;
  const numbers = new Map(quotes.map((q) => [q.id, q.number ?? q.id]));
  const rows = await db
    .select()
    .from(t)
    .where(inArray(t.quoteId, [...numbers.keys()]))
    .orderBy(asc(t.createdAt), asc(t.id));
  return rows.map((a) => ({ ...a, ownerNumber: numbers.get(a.quoteId)! }));
}

/**
 * Zusätzliche Anhänge festgeschriebener Rechnungen (#272) unter rechnungen/anhaenge/ bzw. Angebote (#415) unter
 * angebote/anhaenge/, nur wenn vorhanden, mit anhaenge.csv: Beleg, ursprünglicher Dateiname, Datei im Archiv, SHA-256.
 */
async function* attachmentArchive(where: AttachmentArchive, attachments: AttachmentRow[], problems: string[]): AsyncGenerator<ArchiveFile> {
  if (attachments.length === 0) return;
  const used = new Set<string>();
  const rows: CsvValue[][] = [];
  for (const attachment of attachments) {
    const number = attachment.ownerNumber;
    const path = uniquePath(used, `${where.dir}/${safeName(number, 60)}_${safeName(attachment.filename.replace(/\.pdf$/i, ""), 80, "Anhang")}.pdf`);
    let bytes: Buffer | null = null;
    try {
      bytes = await loadFile(attachment.sha256);
    } catch (error) {
      problems.push(
        `Anhang ${attachment.id} (${attachment.filename}) ${where.of} ${number}: Datei nicht lesbar – ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (bytes) yield { path, content: new Uint8Array(bytes), compress: false };
    rows.push([number, attachment.filename, bytes ? path.slice(where.dir.length + 1) : "", attachment.size, attachment.sha256, attachment.id]);
  }
  yield {
    path: `${where.dir}/anhaenge.csv`,
    content: csv([where.noun, "Dateiname", "Datei", "Größe (Bytes)", "SHA-256", "ID"], rows),
    compress: true,
  };
}
