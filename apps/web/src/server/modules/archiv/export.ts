import { createHash } from "node:crypto";
import { and, asc, between, desc, eq, getTableColumns, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { bankAccountIncludedSql } from "../../db/bank-open.ts";
import { effectivePayment } from "./payment-history.ts";
import { effectiveContactName, effectiveDirection, effectiveTaxes, effectiveType } from "./sevdesk-richtung.ts";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import pkg from "../../../../package.json" with { type: "json" };
import {
  ASSET_KINDS,
  ASSET_METHODS,
  csvDecimal,
  formatDegressiveRate,
  formatExchangeRate,
  isKapitalgesellschaft,
  PAUSCHALE_LABEL,
  WRITE_OFF_KINDS,
} from "@haben/core";
import { listAssets } from "../buchhaltung/index.ts";
import { db, schema } from "../../db/index.ts";
import { accountName, openingCash } from "../buchhaltung/index.ts";
import { loadFile } from "../../storage.ts";
import { cashBookCsv } from "../bank/index.ts";
import { splitsByDocument } from "../belege/index.ts";
import { chainHead, formatPruefwert } from "../auswertungen/index.ts";
import { today } from "../../today.ts";
import { externalImportArchive } from "./external-import-archive.ts";
import { VERRECHNUNGEN_HEADER, verrechnungenFuerArchiv } from "./export-verrechnung.ts";

/**
 * Jahresarchiv als ZIP: alle Rechnungen, Belege, Buchungen, Bankumsätze, Voranmeldungen,
 * Stammdaten und das Änderungsprotokoll eines Kalenderjahrs für die Aufbewahrung.
 *
 * Das ZIP wird mit fflate Datei für Datei erzeugt und als Stream ausgeliefert: Es liegt immer
 * höchstens eine Datei im Speicher, und der nächste Beleg wird erst gelesen, wenn der Client
 * den vorigen abgenommen hat. Das ELSTER-Zertifikat gehört nie ins Archiv.
 */

export const HABEN_VERSION: string = pkg.version;

// ---------------------------------------------------------------------------
// CSV: UTF-8 mit BOM, Semikolon, Dezimalkomma, ISO-Daten, Quoting nach RFC 4180

export type CsvValue = string | number | boolean | null | undefined;

export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "boolean" ? (value ? "ja" : "nein") : String(value);
  // Text, den Tabellenprogramme als Formel lesen würden, entschärfen; negative Beträge bleiben Zahlen
  const text = typeof value === "string" && /^[=+@\t\r]|^-(?!\d+(,\d+)?$)/.test(raw) ? `'${raw}` : raw;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: CsvValue[]): string {
  return `${values.map(csvField).join(";")}\r\n`;
}

const encoder = new TextEncoder();
const BOM = "﻿";

export function csv(header: string[], rows: CsvValue[][]): Uint8Array {
  return encoder.encode(BOM + csvLine(header) + rows.map(csvLine).join(""));
}

/** Cent als Dezimalzahl mit Komma, ohne Tausenderpunkt: 123456 → "1234,56" */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return csvDecimal(cents);
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : "");
const json = (value: unknown) => (value === null || value === undefined ? "" : JSON.stringify(value));

// ---------------------------------------------------------------------------
// Dateinamen

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" };

/** ASCII, ohne Pfadtrenner und Sonderzeichen, gekürzt; leer wird zum Ersatzwert. */
export function safeName(value: string, maxLength = 40, fallback = "unbekannt"): string {
  const ascii = value
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const cut = ascii.slice(0, maxLength).replace(/[-.]+$/g, "");
  return cut || fallback;
}

/** Hängt -2, -3 … vor der Endung an, bis der Pfad frei ist. */
function uniquePath(used: Set<string>, path: string): string {
  let candidate = path;
  const dot = path.lastIndexOf(".");
  const [stem, ext] = dot > path.lastIndexOf("/") ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/xml": "xml",
};

// ---------------------------------------------------------------------------
// ZIP-Stream mit Prüfsummen

export interface ArchiveFile {
  path: string;
  content: Uint8Array | AsyncIterable<Uint8Array>;
  /** PDFs und Fotos sind schon komprimiert und werden nur gespeichert */
  compress: boolean;
}

export const CHECKSUM_FILE = "pruefsummen.sha256";

/**
 * Packt die Dateien nacheinander ins ZIP und liefert die fertigen Bytes stückweise.
 * Zum Schluss kommt pruefsummen.sha256 im Format von `sha256sum` dazu.
 */
export async function* zipArchive(files: AsyncIterable<ArchiveFile>, mtime: Date): AsyncGenerator<Uint8Array> {
  const queue: Uint8Array[] = [];
  let failure: Error | null = null;
  let written = 0;
  let entries = 0;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else if (chunk.length > 0) {
      written += chunk.length;
      queue.push(chunk);
    }
  });
  function* drain(): Generator<Uint8Array> {
    if (failure) throw failure;
    while (queue.length > 0) yield queue.shift()!;
  }

  const checksums: string[] = [];
  const add = async function* (file: ArchiveFile): AsyncGenerator<Uint8Array> {
    // fflate kennt kein ZIP64: lieber abbrechen als ein still kaputtes Archiv ausliefern
    if (++entries > 0xffff || written >= 0xffffffff)
      throw new Error("Das Jahresarchiv überschreitet 4 GB oder 65.535 Dateien; das kann das ZIP-Format ohne ZIP64 nicht.");
    const entry = file.compress ? new ZipDeflate(file.path, { level: 6 }) : new ZipPassThrough(file.path);
    entry.mtime = mtime;
    zip.add(entry);
    const hash = createHash("sha256");
    if (file.content instanceof Uint8Array) {
      hash.update(file.content);
      entry.push(file.content, true);
    } else {
      for await (const chunk of file.content) {
        hash.update(chunk);
        entry.push(chunk, false);
        yield* drain();
      }
      entry.push(new Uint8Array(0), true);
    }
    checksums.push(`${hash.digest("hex")}  ${file.path}`);
    yield* drain();
  };

  for await (const file of files) yield* add(file);
  yield* add({ path: CHECKSUM_FILE, content: encoder.encode(`${checksums.join("\n")}\n`), compress: true });
  if (written >= 0xffffffff) throw new Error("Das Jahresarchiv überschreitet 4 GB; das kann das ZIP-Format ohne ZIP64 nicht.");
  zip.end();
  yield* drain();
}

export function toReadableStream(chunks: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { value, done } = await chunks.next();
          if (done) controller.close();
          else controller.enqueue(value);
        } catch (error) {
          console.error("Jahresarchiv abgebrochen", error);
          controller.error(error);
        }
      },
      async cancel() {
        await chunks.return(undefined);
      },
    },
    { highWaterMark: 1 },
  );
}

// ---------------------------------------------------------------------------
// Inhalte eines Jahres

const yearStart = (year: number) => `${year}-01-01`;
const yearEnd = (year: number) => `${year}-12-31`;
/** Beginn eines Jahres in deutscher Zeit, für Zeitstempel-Spalten */
const berlinStart = (year: number) => sql`(${`${year}-01-01 00:00:00`}::timestamp at time zone 'Europe/Berlin')`;

const KIND_LABELS: Record<string, string> = {
  rechnung: "Rechnung",
  storno: "Stornorechnung",
  korrektur: "Rechnungskorrektur",
  abschlag: "Abschlagsrechnung",
  schluss: "Schlussrechnung",
};
const FORMAT_LABELS: Record<string, string> = { zugferd: "ZUGFeRD", "xrechnung-cii": "XRechnung (CII)", "xrechnung-ubl": "XRechnung (UBL)" };
const SOURCE_LABELS: Record<string, string> = {
  invoice: "Rechnung",
  document: "Beleg",
  allocation: "Zahlung",
  asset: "Anlage",
  pauschale: "Pauschale",
  kasse: "Kasse",
  ausbuchung: "Ausbuchung",
  manuell: "Manuell",
  eroeffnung: "Eröffnung",
  ausschuettung: "Ausschüttung",
  lohn: "Lohn",
};
const ALLOCATION_LABELS: Record<(typeof schema.allocationKindEnum.enumValues)[number], string> = {
  invoice: "Rechnung",
  document: "Beleg",
  privat: "Privat",
  spende: "Spende (Zuwendungen, Spenden)",
  geldtransit: "Geldtransit",
  ustVorauszahlung: "USt-Vorauszahlung",
  sondervorauszahlung: "USt-Sondervorauszahlung",
  kapest: "Kapitalertragsteuer",
  lohn: "Lohn/Gehalt",
  lohnsteuer: "Lohnsteuer",
  sozialversicherung: "SV-Beiträge",
  steuer: "Steuerzahlung",
  zinsertrag: "Zinserträge",
  darlehen: "Darlehen",
  kategorie: "Direkt auf Kategorie",
  gebuehren: "Bankgebühren",
  mahnerloes: "Mahngebühren und Zinsen",
  kursdifferenz: "Kursdifferenz",
};
const SUBMISSION_LABELS: Record<string, string> = { validate: "Prüfung", test: "Testübermittlung", send: "Übermittlung" };

/** Das ZIP-Archiv eines Kalenderjahrs als Byte-Stücke */
export function exportYear(year: number, now = new Date()): AsyncGenerator<Uint8Array> {
  return zipArchive(yearFiles(year, now), now);
}

export function exportFilename(year: number, now = new Date()): string {
  return `Haben-${year}-${today(now)}.zip`;
}

/** Jahre mit Daten, absteigend; das laufende und das vorige Jahr sind immer dabei. */
export async function exportYears(now = new Date()): Promise<number[]> {
  const rows = await db.execute<{ y: number }>(sql`
    select extract(year from issue_date)::int as y from invoices where status = 'final'
    union select extract(year from coalesce(document_date, (uploaded_at at time zone 'Europe/Berlin')::date))::int from documents
    union select extract(year from date)::int from journal_entries
    union select extract(year from booking_date)::int from bank_transactions where bank_account_id not in (select id from bank_accounts where excluded_at is not null)
    union select year::int from vat_returns
    union select extract(year from date)::int from lexoffice_vouchers
    union select extract(year from date)::int from legacy_order_documents
    union select extract(year from date)::int from datev_bookings
    union select year::int from archive_files where year is not null`);
  const current = Number(today(now).slice(0, 4));
  const years = new Set([current, current - 1, ...rows.map((r) => Number(r.y))]);
  return [...years].sort((a, b) => b - a);
}

async function* yearFiles(year: number, now: Date): AsyncGenerator<ArchiveFile> {
  const [company] = await db.select().from(schema.company).where(eq(schema.company.id, 1));
  const problems: string[] = [];

  yield { path: "LIESMICH.txt", content: encoder.encode(readme(year, now, company)), compress: true };
  yield* externalImportArchive(year);

  // Rechnungen ------------------------------------------------------------
  const invoices = await db
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
    invoiceRows.push([
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
    ]);
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

  // Angebote (Handelsbriefe, nur wenn vorhanden) -------------------------
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

  // Belege ----------------------------------------------------------------
  const documentDay = sql<string>`coalesce(${schema.documents.documentDate}, (${schema.documents.uploadedAt} at time zone 'Europe/Berlin')::date)::text`;
  const documents = await db
    .select({
      id: schema.documents.id,
      day: documentDay,
      sha256: schema.documents.sha256,
      filename: schema.documents.filename,
      mimeType: schema.documents.mimeType,
      status: schema.documents.status,
      extractedBy: schema.documents.extractedBy,
      supplierName: schema.documents.supplierName,
      supplierUstId: schema.documents.supplierUstId,
      invoiceNumber: schema.documents.invoiceNumber,
      documentDate: schema.documents.documentDate,
      dueDate: schema.documents.dueDate,
      category: schema.documents.category,
      payment: schema.documents.payment,
      note: schema.documents.note,
      currency: schema.documents.currency,
      exchangeRate: schema.documents.exchangeRate,
      reverseCharge: schema.documents.reverseCharge,
      net: schema.documents.net,
      tax: schema.documents.tax,
      gross: schema.documents.gross,
      privateShare: schema.documents.privateShare,
      lockedAt: schema.documents.lockedAt,
      uploadedAt: schema.documents.uploadedAt,
      // Storno (#237): der Beleg bleibt gebucht, die Gegenbuchung steht im Journal
      cancelledOn: schema.documentCancellations.date,
      cancellationReason: schema.documentCancellations.reason,
    })
    .from(schema.documents)
    .leftJoin(schema.documentCancellations, eq(schema.documentCancellations.documentId, schema.documents.id))
    .where(sql`${documentDay}::date between ${yearStart(year)}::date and ${yearEnd(year)}::date`)
    .orderBy(asc(documentDay), asc(schema.documents.uploadedAt), asc(schema.documents.id));

  const amounts = documents.length
    ? await db
        .select()
        .from(schema.documentAmounts)
        .where(
          inArray(
            schema.documentAmounts.documentId,
            documents.map((d) => d.id),
          ),
        )
    : [];
  const amountsByDocument = groupBy(amounts, (a) => a.documentId);
  const splits = await splitsByDocument(documents.map((d) => d.id));
  const usedDocumentPaths = new Set<string>();
  const documentPaths = new Map<string, string>();
  const documentRows: CsvValue[][] = [];
  for (const doc of documents) {
    const ext = EXTENSIONS[doc.mimeType] ?? "bin";
    const path = uniquePath(usedDocumentPaths, `belege/${doc.day}_${safeName(doc.supplierName)}_${doc.id.slice(0, 8)}.${ext}`);
    let bytes: Buffer | null = null;
    try {
      bytes = await loadFile(doc.sha256);
    } catch (error) {
      problems.push(`Beleg ${doc.id} (${doc.filename}): Datei nicht lesbar – ${error instanceof Error ? error.message : String(error)}`);
    }
    if (bytes) {
      documentPaths.set(doc.id, path);
      yield { path, content: new Uint8Array(bytes), compress: ext === "xml" };
    }
    const docAmounts = amountsByDocument.get(doc.id) ?? [];
    const rate = (r: number) => docAmounts.find((a) => a.taxRate === r);
    documentRows.push([
      doc.documentDate,
      doc.supplierName,
      doc.supplierUstId,
      doc.invoiceNumber,
      // Aufgeteilt (#271): Kategorie, Satz und Netto je Zeile, z. B. „wareneinkauf 19 % 100,00 | software 19 % 50,00“
      doc.category ?? (splits.get(doc.id) ?? []).map((l) => `${l.category} ${l.taxRate / 100} % ${money(l.net)}`).join(" | "),
      money(rate(1900)?.net),
      money(rate(1900)?.tax),
      money(rate(700)?.net),
      money(rate(700)?.tax),
      money(rate(0)?.net),
      money(doc.net),
      money(doc.tax),
      money(doc.gross),
      doc.privateShare,
      doc.currency,
      // Fremdwährung: Kurs (1 EUR = …) und Bruttobetrag laut Beleg; die Beträge davor sind in Euro umgerechnet
      doc.exchangeRate ? formatExchangeRate(doc.exchangeRate) : null,
      doc.currency === "EUR" ? null : money(docAmounts.reduce((s, a) => s + (a.originalNet ?? 0) + (doc.reverseCharge ? 0 : (a.originalTax ?? 0)), 0)),
      // In GmbH und UG hat der Gesellschafter ausgelegt (Verrechnungskonto), im Einzelunternehmen der Inhaber privat
      doc.payment === "privat"
        ? company && isKapitalgesellschaft(company.rechtsform)
          ? "Gesellschafter"
          : "privat"
        : doc.payment === "kasse"
          ? "Kasse"
          : "Bank",
      doc.status,
      iso(doc.lockedAt),
      doc.cancelledOn,
      doc.cancellationReason,
      doc.extractedBy,
      doc.dueDate,
      doc.note,
      doc.sha256,
      doc.filename,
      bytes ? path.replace(/^belege\//, "") : "FEHLT",
      iso(doc.uploadedAt),
      doc.id,
    ]);
  }
  yield {
    path: "belege/belege.csv",
    content: csv(
      [
        "Datum",
        "Lieferant",
        "USt-IdNr.",
        "Rechnungsnummer",
        "Kategorie",
        "Netto 19 %",
        "Vorsteuer 19 %",
        "Netto 7 %",
        "Vorsteuer 7 %",
        "Netto 0 %",
        "Netto",
        "Vorsteuer",
        "Brutto",
        "Privatanteil %",
        "Währung",
        "Kurs (1 EUR =)",
        "Brutto in Währung",
        "Zahlung",
        "Status",
        "Gebucht am",
        "Storniert am",
        "Storno-Grund",
        "Quelle",
        "Fällig",
        "Notiz",
        "SHA-256",
        "Originaldateiname",
        "Datei im Archiv",
        "Hochgeladen",
        "ID",
      ],
      documentRows,
    ),
    compress: true,
  };

  // Verrechnungen zweier Eingangsbelege (#274): eigene Datei, siehe export-verrechnung.ts
  const verrechnungen = await verrechnungenFuerArchiv(documentPaths, {
    documentDay,
    von: yearStart(year),
    bis: yearEnd(year),
    safeName,
    extension: (mimeType) => EXTENSIONS[mimeType] ?? "bin",
    money,
    iso,
  });
  if (verrechnungen) {
    yield { path: "belege/verrechnungen.csv", content: csv(VERRECHNUNGEN_HEADER, verrechnungen), compress: true };
  }

  // Buchungen -------------------------------------------------------------
  const entries = await db
    .select()
    .from(schema.journalEntries)
    .where(and(gte(schema.journalEntries.date, yearStart(year)), lte(schema.journalEntries.date, yearEnd(year))))
    .orderBy(asc(schema.journalEntries.date), asc(schema.journalEntries.createdAt), asc(schema.journalEntries.id));
  const journalLines = entries.length
    ? await db
        .select()
        .from(schema.journalLines)
        .where(
          inArray(
            schema.journalLines.entryId,
            entries.map((e) => e.id),
          ),
        )
        .orderBy(asc(schema.journalLines.credit), asc(schema.journalLines.account))
    : [];
  const linesByEntry = groupBy(journalLines, (l) => l.entryId);
  const journalRows: CsvValue[][] = entries.flatMap((entry) =>
    (linesByEntry.get(entry.id) ?? []).map((line) => [
      entry.date,
      entry.id,
      entry.description,
      SOURCE_LABELS[entry.sourceType] ?? entry.sourceType,
      entry.sourceId,
      entry.kontenrahmen,
      line.account,
      accountName(entry.kontenrahmen, line.account),
      line.debit ? money(line.debit) : "",
      line.credit ? money(line.credit) : "",
      line.taxCode,
      line.basis === null ? "" : money(line.basis),
      entry.reversesId,
      iso(entry.lockedAt),
      iso(entry.createdAt),
    ]),
  );
  yield {
    path: "buchungen/journal.csv",
    content: csv(
      [
        "Datum",
        "Buchungs-ID",
        "Beschreibung",
        "Quelle",
        "Quell-ID",
        "Kontenrahmen",
        "Konto",
        "Kontoname",
        "Soll",
        "Haben",
        "Steuerschlüssel",
        "Bemessungsgrundlage",
        "Gegenbuchung zu",
        "Festgeschrieben",
        "Erfasst",
      ],
      journalRows,
    ),
    compress: true,
  };

  // Anlagen --------------------------------------------------------------
  const assetRows: CsvValue[][] = (await listAssets(year))
    // auch voll abgeschriebene Fahrzeuge, die noch privat genutzt werden
    .filter((a) => a.year !== null || (a.privateUseYear?.months.length ?? 0) > 0)
    .map((a) => [
      a.name,
      ASSET_KINDS[a.kind].label,
      ASSET_METHODS[a.method],
      a.account,
      a.acquisitionDate,
      money(a.cost),
      a.usefulLifeMonths,
      // Verzeichnis nach § 7a Abs. 8 EStG für die degressive AfA: Satz und Wechsel zur linearen
      a.degressiveRate === null ? "" : formatDegressiveRate(a.degressiveRate),
      a.linearFromYear,
      a.memoValue,
      a.openingDate,
      a.openingBookValue === null ? "" : money(a.openingBookValue),
      money(a.year?.opening ?? 0),
      money(a.year?.addition ?? 0),
      money(a.year?.depreciation ?? 0),
      money(a.year?.disposal ?? 0),
      money(a.year?.closing ?? 0),
      a.disposalDate,
      a.privateUse ? `${a.privateUse.rate / 100} %`.replace(".", ",") : "",
      a.privateUse ? money(a.privateUse.listPrice) : "",
      a.privateUseYear ? money(a.privateUseYear.withdrawal) : "",
      a.privateUseYear ? money(a.privateUseYear.vat) : "",
      a.bookedYears.includes(year),
      a.documentId,
      a.id,
    ]);
  yield {
    path: "anlagen/anlagenverzeichnis.csv",
    content: csv(
      [
        "Bezeichnung",
        "Art",
        "Abschreibung",
        "Anlagekonto",
        "Anschaffung",
        "Anschaffungskosten",
        "Nutzungsdauer (Monate)",
        "Degressiver Satz",
        "Linear ab",
        "Erinnerungswert",
        "Übernommen zum",
        "Buchwert bei Übernahme",
        "Buchwert Jahresanfang",
        "Zugang",
        "AfA",
        "Abgang (Restbuchwert)",
        "Buchwert Jahresende",
        "Abgangsdatum",
        "Privatnutzung Satz",
        "Bruttolistenpreis",
        "Privatnutzung Entnahme",
        "Privatnutzung Umsatzsteuer",
        "AfA gebucht",
        "Beleg-ID",
        "ID",
      ],
      assetRows,
    ),
    compress: true,
  };

  // Pauschalen (Eigenbelege) ---------------------------------------------
  const pauschalen = await db
    .select()
    .from(schema.pauschalen)
    .where(between(schema.pauschalen.date, yearStart(year), yearEnd(year)))
    .orderBy(asc(schema.pauschalen.date), asc(schema.pauschalen.createdAt), asc(schema.pauschalen.id));
  if (pauschalen.length > 0) {
    yield {
      path: "pauschalen/pauschalen.csv",
      content: csv(
        ["Datum", "Art", "Beschreibung", "Angaben", "Betrag", "Storno von", "Buchungs-ID", "Erfasst", "ID"],
        pauschalen.map((p) => [
          p.date,
          PAUSCHALE_LABEL[p.art],
          p.description,
          JSON.stringify(p.details),
          money(p.amount),
          p.reversesId,
          p.journalEntryId,
          p.createdAt.toISOString(),
          p.id,
        ]),
      ),
      compress: true,
    };
  }

  // Kassenbuch: mit Anfangsbestand und Bestand nach jeder Zeile; auch wenn nur die Eröffnung einen Bestand bringt
  if ((await db.select({ id: schema.cashEntries.id }).from(schema.cashEntries).limit(1)).length > 0 || (await openingCash()).length > 0) {
    yield { path: "kasse/kassenbuch.csv", content: encoder.encode(await cashBookCsv(year)), compress: true };
  }

  // Bank ------------------------------------------------------------------
  // Ein ausgeschlossenes Konto (#462) gehört nicht zu dieser Firma und fehlt im Archiv
  const accounts = await db.select().from(schema.bankAccounts).where(isNull(schema.bankAccounts.excludedAt)).orderBy(asc(schema.bankAccounts.iban));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const transactions = await db
    .select()
    .from(schema.bankTransactions)
    .where(
      and(
        gte(schema.bankTransactions.bookingDate, yearStart(year)),
        lte(schema.bankTransactions.bookingDate, yearEnd(year)),
        bankAccountIncludedSql("bank_account_id"),
      ),
    )
    .orderBy(asc(schema.bankTransactions.bookingDate), asc(schema.bankTransactions.createdAt), asc(schema.bankTransactions.id));
  const transactionById = new Map(transactions.map((t) => [t.id, t]));
  const allocations = transactions.length
    ? await db
        .select()
        .from(schema.allocations)
        .where(
          inArray(
            schema.allocations.transactionId,
            transactions.map((t) => t.id),
          ),
        )
        .orderBy(asc(schema.allocations.createdAt), asc(schema.allocations.id))
    : [];
  const imports = await db
    .select()
    .from(schema.bankImports)
    .where(
      and(
        sql`(exists (select 1 from bank_transactions t where t.import_id = ${schema.bankImports.id}
            and t.booking_date between ${yearStart(year)}::date and ${yearEnd(year)}::date)
          or (${schema.bankImports.periodFrom} <= ${yearEnd(year)}::date and ${schema.bankImports.periodTo} >= ${yearStart(year)}::date))`,
        bankAccountIncludedSql("bank_account_id"),
      ),
    )
    .orderBy(asc(schema.bankImports.createdAt));
  const importById = new Map(imports.map((i) => [i.id, i]));

  const allocatedByTransaction = new Map<string, number>();
  for (const a of allocations) allocatedByTransaction.set(a.transactionId, (allocatedByTransaction.get(a.transactionId) ?? 0) + a.amount);
  // Verrechnungen gegenläufiger Umsätze (#457), an denen ein Umsatz des Jahres beteiligt ist; samt Gegenzeilen. Die Umsätze
  // des Jahres wählt SQL über das Buchungsdatum: Als Liste von IDs, zweimal, sprengten sie ab 32.768 Umsätzen die
  // Grenze von 65.534 Parametern
  const yearTransactionIds = sql`(select t.id from bank_transactions t where t.booking_date between ${yearStart(year)}::date and ${yearEnd(year)}::date)`;
  const neutralizations = transactions.length
    ? await db
        .select()
        .from(schema.bankNeutralizations)
        .where(
          or(
            sql`${schema.bankNeutralizations.transactionId} in ${yearTransactionIds}`,
            sql`${schema.bankNeutralizations.counterTransactionId} in ${yearTransactionIds}`,
          ),
        )
        .orderBy(asc(schema.bankNeutralizations.createdAt), asc(schema.bankNeutralizations.id))
    : [];
  const reversedNeutralizations = new Set(neutralizations.flatMap((n) => (n.reversesId ? [n.reversesId] : [])));
  const neutralized = new Set(
    neutralizations.filter((n) => !n.reversesId && !reversedNeutralizations.has(n.id)).flatMap((n) => [n.transactionId, n.counterTransactionId]),
  );

  const usedBankPaths = new Set<string>();
  for (const [accountId, rows] of groupBy(transactions, (t) => t.bankAccountId)) {
    const account = accountById.get(accountId);
    yield {
      path: uniquePath(usedBankPaths, `bank/${safeName(account?.iban ?? account?.name ?? accountId, 40)}/umsaetze.csv`),
      content: csv(
        [
          "Buchungsdatum",
          "Wertstellung",
          "Betrag",
          "Währung",
          "Gegenpartei",
          "Gegen-IBAN",
          "Verwendungszweck",
          "Umsatztyp",
          "Bankreferenz",
          "Zugeordnet",
          "Offen",
          "Verrechnet",
          "Importdatei",
          "Umsatz-ID",
        ],
        rows.map((t) => {
          const allocated = allocatedByTransaction.get(t.id) ?? 0;
          return [
            t.bookingDate,
            t.valueDate,
            money(t.amount),
            t.currency,
            t.counterpartyName,
            t.counterpartyIban,
            t.purpose,
            t.type,
            t.bankReference,
            money(allocated),
            money(neutralized.has(t.id) ? 0 : t.amount - allocated),
            neutralized.has(t.id),
            importById.get(t.importId)?.filename ?? t.importId,
            t.id,
          ];
        }),
      ),
      compress: true,
    };
  }

  const allocatedInvoiceIds = [...new Set(allocations.map((a) => a.invoiceId).filter((id): id is string => id !== null))];
  if (allocatedInvoiceIds.some((id) => !invoiceNumbers.has(id))) {
    for (const row of await db
      .select({ id: schema.invoices.id, number: schema.invoices.number })
      .from(schema.invoices)
      .where(inArray(schema.invoices.id, allocatedInvoiceIds))) {
      invoiceNumbers.set(row.id, row.number);
    }
  }
  yield {
    path: "bank/zuordnungen.csv",
    content: csv(
      ["Buchungsdatum", "Konto", "Art", "Rechnung", "Beleg", "Betrag", "Hebt auf", "Angelegt", "Umsatz-ID", "Rechnungs-ID", "Beleg-ID", "Zuordnungs-ID"],
      allocations.map((a) => {
        const t = transactionById.get(a.transactionId);
        return [
          t?.bookingDate,
          t ? (accountById.get(t.bankAccountId)?.iban ?? accountById.get(t.bankAccountId)?.name) : "",
          ALLOCATION_LABELS[a.kind],
          a.invoiceId ? (invoiceNumbers.get(a.invoiceId) ?? "") : "",
          a.documentId ? (documentPaths.get(a.documentId)?.replace(/^belege\//, "") ?? "") : "",
          money(a.amount),
          a.reversesId,
          iso(a.createdAt),
          a.transactionId,
          a.invoiceId,
          a.documentId,
          a.id,
        ];
      }),
    ),
    compress: true,
  };
  if (neutralizations.length > 0) {
    // Gegenumsatz außerhalb des Jahres: nachladen, damit Datum und Betrag beider Seiten in der Zeile stehen
    const missing = [...new Set(neutralizations.flatMap((n) => [n.transactionId, n.counterTransactionId]))].filter((id) => !transactionById.has(id));
    const outside = missing.length > 0 ? await db.select().from(schema.bankTransactions).where(inArray(schema.bankTransactions.id, missing)) : [];
    const byId = new Map([...transactionById, ...outside.map((t) => [t.id, t] as const)]);
    yield {
      path: "bank/verrechnungen.csv",
      content: csv(
        [
          "Konto",
          "Buchungsdatum",
          "Betrag",
          "Gegenumsatz Buchungsdatum",
          "Gegenumsatz Betrag",
          "Notiz",
          "Hebt auf",
          "Angelegt",
          "Umsatz-ID",
          "Gegenumsatz-ID",
          "Verrechnungs-ID",
        ],
        neutralizations.map((n) => {
          const t = byId.get(n.transactionId);
          const c = byId.get(n.counterTransactionId);
          return [
            t ? (accountById.get(t.bankAccountId)?.iban ?? accountById.get(t.bankAccountId)?.name) : "",
            t?.bookingDate,
            money(t?.amount),
            c?.bookingDate,
            money(c?.amount),
            n.note,
            n.reversesId,
            iso(n.createdAt),
            n.transactionId,
            n.counterTransactionId,
            n.id,
          ];
        }),
      ),
      compress: true,
    };
  }
  // Ausbuchungen des Jahres (Skonto, Forderungsausfall, erhaltenes Skonto) nach Datum der Ausbuchung
  const writeOffs = await db
    .select({ writeOff: schema.writeOffs, cashNumber: schema.cashEntries.number })
    .from(schema.writeOffs)
    // Skonto zu einer Bareinnahme: die Zeile im Kassenbuch (kasse/kassenbuch.csv), wie die Umsatz-ID bei der Bank
    .leftJoin(schema.cashEntries, eq(schema.cashEntries.id, schema.writeOffs.cashEntryId))
    .where(and(gte(schema.writeOffs.date, yearStart(year)), lte(schema.writeOffs.date, yearEnd(year))))
    .orderBy(asc(schema.writeOffs.date), asc(schema.writeOffs.createdAt), asc(schema.writeOffs.id));
  if (writeOffs.length > 0) {
    const missing = [...new Set(writeOffs.map(({ writeOff: w }) => w.invoiceId).filter((id): id is string => id !== null && !invoiceNumbers.has(id)))];
    if (missing.length > 0) {
      for (const row of await db
        .select({ id: schema.invoices.id, number: schema.invoices.number })
        .from(schema.invoices)
        .where(inArray(schema.invoices.id, missing))) {
        invoiceNumbers.set(row.id, row.number);
      }
    }
    yield {
      path: "bank/ausbuchungen.csv",
      content: csv(
        ["Datum", "Art", "Rechnung", "Beleg", "Betrag", "Hebt auf", "Angelegt", "Umsatz-ID", "Rechnungs-ID", "Beleg-ID", "Ausbuchungs-ID", "Kassenbuch-Nr."],
        writeOffs.map(({ writeOff: w, cashNumber }) => [
          w.date,
          WRITE_OFF_KINDS[w.kind],
          w.invoiceId ? (invoiceNumbers.get(w.invoiceId) ?? "") : "",
          w.documentId ? (documentPaths.get(w.documentId)?.replace(/^belege\//, "") ?? "") : "",
          money(w.amount),
          w.reversesId,
          iso(w.createdAt),
          w.transactionId,
          w.invoiceId,
          w.documentId,
          w.id,
          cashNumber,
        ]),
      ),
      compress: true,
    };
  }
  yield {
    path: "bank/importe.csv",
    content: csv(
      [
        "Konto",
        "Datei",
        "SHA-256",
        "Format",
        "Zeitraum von",
        "Zeitraum bis",
        "Anfangssaldo",
        "Endsaldo",
        "Neu",
        "Übersprungen",
        "Hinweise",
        "Importiert",
        "Import-ID",
      ],
      imports.map((i) => [
        accountById.get(i.bankAccountId)?.iban ?? accountById.get(i.bankAccountId)?.name,
        i.filename,
        i.sha256,
        i.format,
        i.periodFrom,
        i.periodTo,
        money(i.openingBalance),
        money(i.closingBalance),
        i.added,
        i.skipped,
        i.warnings.join(" | "),
        iso(i.createdAt),
        i.id,
      ]),
    ),
    compress: true,
  };

  // Umsatzsteuer ----------------------------------------------------------
  const vatReturns = await db
    .select()
    .from(schema.vatReturns)
    .where(eq(schema.vatReturns.year, year))
    .orderBy(asc(schema.vatReturns.month), asc(schema.vatReturns.createdAt));
  const submissions = vatReturns.length
    ? await db
        .select({
          id: schema.vatReturnSubmissions.id,
          vatReturnId: schema.vatReturnSubmissions.vatReturnId,
          kind: schema.vatReturnSubmissions.kind,
          ok: schema.vatReturnSubmissions.ok,
          code: schema.vatReturnSubmissions.code,
          message: schema.vatReturnSubmissions.message,
          transferTicket: schema.vatReturnSubmissions.transferTicket,
          createdAt: schema.vatReturnSubmissions.createdAt,
          hasPdf: sql<boolean>`${schema.vatReturnSubmissions.protocolPdf} is not null`,
        })
        .from(schema.vatReturnSubmissions)
        .where(
          inArray(
            schema.vatReturnSubmissions.vatReturnId,
            vatReturns.map((r) => r.id),
          ),
        )
        .orderBy(asc(schema.vatReturnSubmissions.createdAt))
    : [];
  // Abgaben außerhalb von Haben: das Übermittlungsprotokoll aus Mein ELSTER liegt im Dokumentenspeicher
  const filings = vatReturns.length
    ? await db
        .select()
        .from(schema.vatReturnFilings)
        .where(
          inArray(
            schema.vatReturnFilings.vatReturnId,
            vatReturns.map((r) => r.id),
          ),
        )
    : [];
  for (const [month, returns] of groupBy(vatReturns, (r) => r.month)) {
    const dir = `umsatzsteuer/${year}-${String(month).padStart(2, "0")}`;
    const submissionRows: CsvValue[][] = [];
    for (const [index, vatReturn] of returns.entries()) {
      const suffix = returns.length > 1 ? `-${index + 1}` : "";
      yield { path: `${dir}/anmeldung${suffix}.json`, content: encoder.encode(`${JSON.stringify(vatReturn, null, 2)}\n`), compress: true };
      for (const submission of submissions.filter((s) => s.vatReturnId === vatReturn.id)) {
        const stem = `${today(submission.createdAt)}_${submission.kind}_${submission.id.slice(0, 8)}`;
        const [files] = await db
          .select({
            protocolPdf: schema.vatReturnSubmissions.protocolPdf,
            requestXml: schema.vatReturnSubmissions.requestXml,
            responseXml: schema.vatReturnSubmissions.responseXml,
            serverResponseXml: schema.vatReturnSubmissions.serverResponseXml,
          })
          .from(schema.vatReturnSubmissions)
          .where(eq(schema.vatReturnSubmissions.id, submission.id));
        const names: string[] = [];
        if (files?.protocolPdf) {
          names.push(`${stem}_protokoll.pdf`);
          yield { path: `${dir}/${stem}_protokoll.pdf`, content: new Uint8Array(files.protocolPdf), compress: false };
        } else names.push("");
        for (const [key, label] of [
          ["requestXml", "anfrage"],
          ["responseXml", "antwort"],
          ["serverResponseXml", "server-antwort"],
        ] as const) {
          const text = files?.[key] ?? "";
          if (text) {
            names.push(`${stem}_${label}.xml`);
            yield { path: `${dir}/${stem}_${label}.xml`, content: encoder.encode(text), compress: true };
          } else names.push("");
        }
        submissionRows.push([
          iso(submission.createdAt),
          SUBMISSION_LABELS[submission.kind] ?? submission.kind,
          submission.ok,
          submission.code,
          submission.message,
          submission.transferTicket,
          ...names,
          `anmeldung${suffix}.json`,
          submission.id,
        ]);
      }
      for (const filing of filings.filter((f) => f.vatReturnId === vatReturn.id)) {
        const name = `${filing.filedOn}_vermerk_${filing.id.slice(0, 8)}_protokoll.pdf`;
        let bytes: Buffer | null = null;
        try {
          bytes = await loadFile(filing.sha256);
        } catch (error) {
          problems.push(
            `Protokoll der Voranmeldung ${dir.slice("umsatzsteuer/".length)} (${filing.filename}): Datei nicht lesbar – ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (bytes) yield { path: `${dir}/${name}`, content: new Uint8Array(bytes), compress: false };
        submissionRows.push([
          iso(filing.createdAt),
          `Abgabe vermerkt (außerhalb von Haben, abgegeben ${filing.filedOn})`,
          true,
          0,
          `Kz 83 ${money(filing.kz83)}; Protokoll ${filing.filename}, SHA-256 ${filing.sha256}`,
          filing.transferTicket,
          bytes ? name : "",
          "",
          "",
          "",
          `anmeldung${suffix}.json`,
          filing.id,
        ]);
      }
    }
    yield {
      path: `${dir}/übermittlungen.csv`,
      content: csv(
        ["Zeitpunkt", "Art", "Erfolgreich", "Code", "Meldung", "Transfer-Ticket", "Protokoll", "Anfrage", "Antwort", "Server-Antwort", "Anmeldung", "ID"],
        submissionRows,
      ),
      compress: true,
    };
  }

  // Altbestand aus Lexoffice und sevDesk ----------------------------------------
  yield* legacyFiles(year, problems);
  yield* orderFiles(year, problems);

  // Stammdaten ------------------------------------------------------------
  const contacts = await db.select().from(schema.contacts).orderBy(asc(schema.contacts.name), asc(schema.contacts.id));
  yield {
    path: "stammdaten/kontakte.csv",
    content: csv(
      [
        "Kundennummer",
        "Name",
        "Straße",
        "PLZ",
        "Ort",
        "Land",
        "E-Mail",
        "Telefon",
        "USt-IdNr.",
        "IBAN",
        "Leitweg-ID",
        "Rechnungsformat",
        "Version",
        "Archiviert",
        "Angelegt",
        "Geändert",
        "ID",
      ],
      contacts.map((c) => [
        c.kundennummer,
        c.name,
        c.strasse,
        c.plz,
        c.ort,
        c.land,
        c.email,
        c.telefon,
        c.ustId,
        c.iban,
        c.leitwegId,
        c.defaultFormat,
        c.version,
        iso(c.archivedAt),
        iso(c.createdAt),
        iso(c.updatedAt),
        c.id,
      ]),
    ),
    compress: true,
  };
  const versions = await db.select().from(schema.contactVersions).orderBy(asc(schema.contactVersions.contactId), asc(schema.contactVersions.version));
  yield {
    path: "stammdaten/kontakt-versionen.csv",
    content: csv(
      ["Kontakt-ID", "Version", "Name", "Angelegt", "Daten (JSON)"],
      versions.map((v) => [v.contactId, v.version, String(v.data.name ?? ""), iso(v.createdAt), json(v.data)]),
    ),
    compress: true,
  };
  yield {
    path: "stammdaten/bankkonten.csv",
    content: csv(
      ["Name", "IBAN", "Angelegt", "ID"],
      accounts.map((a) => [a.name, a.iban, iso(a.createdAt), a.id]),
    ),
    compress: true,
  };
  // Ohne den Hash des Kalender-Tokens: der gehört zum Zugang, nicht zu den Stammdaten
  const firma = company && { ...company, calendarTokenHash: undefined };
  yield { path: "stammdaten/firma.json", content: encoder.encode(`${JSON.stringify(firma, null, 2)}\n`), compress: true };

  // Änderungsprotokoll, seitenweise gelesen ----------------------------------
  yield { path: "protokoll/audit.csv", content: auditCsv(year), compress: true };
  yield { path: "protokoll/pruefwert.txt", content: encoder.encode(await pruefwertText(year, now)), compress: true };

  if (problems.length > 0) {
    yield { path: "FEHLER.txt", content: encoder.encode(`Beim Erstellen des Archivs fehlten Dateien:\n\n${problems.join("\n")}\n`), compress: true };
  }
}

const LEGACY_SOURCE_LABELS = {
  lexoffice: "Lexoffice",
  sevdesk: "sevDesk",
  buchhaltungsbutler: "BuchhaltungsButler",
  accountable: "Accountable",
  import: "JSON-Import",
} as const;

const LEGACY_TYPE_LABELS: Record<string, string> = {
  invoice: "Rechnung",
  creditnote: "Gutschrift",
  downpaymentinvoice: "Abschlagsrechnung",
  salesinvoice: "Einnahmebeleg",
  salescreditnote: "Einnahme-Gutschrift",
  purchaseinvoice: "Ausgabebeleg",
  purchasecreditnote: "Ausgabe-Gutschrift",
};

/** Auftragskopien bleiben im Export von steuerwirksamen Altbelegen getrennt. */
async function* orderFiles(year: number, problems: string[]): AsyncGenerator<ArchiveFile> {
  const documents = await db
    .select()
    .from(schema.legacyOrderDocuments)
    .where(between(schema.legacyOrderDocuments.date, yearStart(year), yearEnd(year)))
    .orderBy(asc(schema.legacyOrderDocuments.date), asc(schema.legacyOrderDocuments.id));
  if (!documents.length) return;
  const files = await db
    .select()
    .from(schema.legacyOrderFiles)
    .where(
      inArray(
        schema.legacyOrderFiles.orderId,
        documents.map((d) => d.id),
      ),
    )
    .orderBy(asc(schema.legacyOrderFiles.createdAt), asc(schema.legacyOrderFiles.id));
  const byDocument = groupBy(files, (f) => f.orderId);
  const rows: CsvValue[][] = [];
  for (const document of documents) {
    const base = `sevdesk/auftraege/${document.date}_${safeName(document.number || document.externalId)}_${document.id.slice(0, 8)}`;
    yield { path: `${base}/quelle.json`, content: encoder.encode(JSON.stringify(document.raw, null, 2)), compress: true };
    const attached = byDocument.get(document.id) ?? [];
    yield { path: `${base}/dateien.json`, content: encoder.encode(JSON.stringify(attached, null, 2)), compress: true };
    const attempts = await db
      .select()
      .from(schema.legacyOrderPdfAttempts)
      .where(eq(schema.legacyOrderPdfAttempts.orderId, document.id))
      .orderBy(schema.legacyOrderPdfAttempts.createdAt);
    if (attempts.length) yield { path: `${base}/pdf-abrufe.json`, content: encoder.encode(JSON.stringify(attempts, null, 2)), compress: true };
    if (!attached.length) problems.push(`sevdesk-Auftragsdokument ${document.number || document.externalId}: PDF fehlt.`);
    for (const file of attached) {
      const path = `${base}/${file.id.slice(0, 8)}_${safeName(file.filename, 100, "dokument.pdf")}`;
      try {
        yield { path, content: new Uint8Array(await loadFile(file.sha256)), compress: false };
      } catch {
        problems.push(`sevdesk-Auftragsdokument ${document.number || document.externalId}: PDF ${file.filename} nicht lesbar.`);
      }
    }
    rows.push([
      document.date,
      document.kind,
      document.number,
      document.contactName,
      document.status,
      document.currency,
      money(document.net),
      money(document.tax),
      money(document.gross),
      document.externalId,
      attached.map((f) => f.sha256).join(" | "),
      attached.map((f) => `${f.origin}: ${f.filename}`).join(" | "),
    ]);
  }
  yield {
    path: "sevdesk/auftraege.csv",
    content: csv(["Datum", "Art", "Nummer", "Kontakt", "Quellstatus", "Währung", "Netto", "Steuer", "Brutto", "Quell-ID", "SHA-256", "Dateien"], rows),
    compress: true,
  };
}

async function* legacyFiles(year: number, problems: string[]): AsyncGenerator<ArchiveFile> {
  const vouchers = await db
    .select({
      ...getTableColumns(schema.lexofficeVouchers),
      type: effectiveType("lexoffice_vouchers"),
      direction: effectiveDirection("lexoffice_vouchers"),
      contactName: effectiveContactName("lexoffice_vouchers"),
      taxes: effectiveTaxes("lexoffice_vouchers"),
      payment: effectivePayment("lexoffice_vouchers"),
    })
    .from(schema.lexofficeVouchers)
    .where(between(schema.lexofficeVouchers.date, yearStart(year), yearEnd(year)))
    .orderBy(asc(schema.lexofficeVouchers.date), asc(schema.lexofficeVouchers.number), asc(schema.lexofficeVouchers.id));
  const files = vouchers.length
    ? await db
        .select()
        .from(schema.lexofficeVoucherFiles)
        .where(
          inArray(
            schema.lexofficeVoucherFiles.voucherId,
            vouchers.map((v) => v.id),
          ),
        )
        .orderBy(asc(schema.lexofficeVoucherFiles.createdAt), asc(schema.lexofficeVoucherFiles.id))
    : [];
  const filesByVoucher = groupBy(files, (f) => f.voucherId);
  const usedPaths = new Set<string>();
  const rows: CsvValue[][] = [];
  for (const voucher of vouchers) {
    const paths: string[] = [];
    for (const file of filesByVoucher.get(voucher.id) ?? []) {
      const ext = EXTENSIONS[file.mimeType] ?? /\.([A-Za-z0-9]{1,5})$/.exec(file.filename)?.[1]?.toLowerCase() ?? "bin";
      const path = uniquePath(
        usedPaths,
        `lexoffice/belege/${voucher.date}_${safeName(voucher.number || voucher.contactName)}_${voucher.id.slice(0, 8)}.${ext}`,
      );
      try {
        yield { path, content: new Uint8Array(await loadFile(file.sha256)), compress: ext === "xml" };
        paths.push(path.slice("lexoffice/".length));
      } catch (error) {
        problems.push(
          `${LEGACY_SOURCE_LABELS[voucher.source]}-Beleg ${voucher.number || voucher.id}: Datei ${file.filename} nicht lesbar – ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    rows.push([
      voucher.date,
      LEGACY_TYPE_LABELS[voucher.type] ?? voucher.type,
      voucher.direction === "einnahme" ? "Einnahme" : "Ausgabe",
      voucher.number,
      voucher.contactName,
      money(voucher.net),
      money(voucher.tax),
      money(voucher.gross),
      voucher.currency,
      voucher.status,
      voucher.dueDate,
      voucher.payment?.paidDate ?? "",
      json(voucher.taxes),
      json(voucher.categories),
      voucher.remark,
      paths.join(" | "),
      (filesByVoucher.get(voucher.id) ?? []).map((f) => f.sha256).join(" | "),
      voucher.lexofficeId,
      LEGACY_SOURCE_LABELS[voucher.source],
    ]);
  }
  if (vouchers.length > 0) {
    yield {
      path: "lexoffice/belege.csv",
      content: csv(
        [
          "Datum",
          "Art",
          "Richtung",
          "Nummer",
          "Kontakt",
          "Netto",
          "Steuer",
          "Brutto",
          "Währung",
          "Status in der Quelle",
          "Fällig",
          "Bezahlt am",
          "Steuersätze (JSON)",
          "Kategorien (JSON)",
          "Notiz",
          "Dateien",
          "SHA-256",
          "Lexoffice-ID",
          "Quelle",
        ],
        rows,
      ),
      compress: true,
    };
  }

  // Einzelzahlungen nach Zahlungsdatum, also im Jahr des Geldflusses; der Beleg kann in einem anderen Jahr liegen
  const payments = await db
    .select({ payment: schema.legacyVoucherPayments, number: schema.lexofficeVouchers.number, voucher: schema.lexofficeVouchers.lexofficeId })
    .from(schema.legacyVoucherPayments)
    .innerJoin(schema.lexofficeVouchers, eq(schema.lexofficeVouchers.id, schema.legacyVoucherPayments.voucherId))
    .where(between(schema.legacyVoucherPayments.date, yearStart(year), yearEnd(year)))
    .orderBy(asc(schema.legacyVoucherPayments.date), asc(schema.lexofficeVouchers.number), asc(schema.legacyVoucherPayments.externalId));
  if (payments.length > 0) {
    yield {
      path: "lexoffice/zahlungen.csv",
      content: csv(
        ["Datum", "Belegnummer", "Betrag", "Konto", "Konto-ID", "Umsatz-ID", "Zuordnungs-ID", "Beleg-ID der Quelle", "Quelle", "Abgerufen am"],
        payments.map(({ payment: p, number, voucher }) => [
          p.date,
          number,
          money(p.amount),
          p.accountName ?? "",
          p.accountId ?? "",
          p.transactionId ?? "",
          p.externalId,
          voucher,
          LEGACY_SOURCE_LABELS[p.source],
          p.createdAt.toISOString(),
        ]),
      ),
      compress: true,
    };
  }

  const bookings = await db
    .select({ booking: schema.datevBookings, filename: schema.archiveFiles.filename })
    .from(schema.datevBookings)
    .innerJoin(schema.archiveFiles, eq(schema.archiveFiles.id, schema.datevBookings.fileId))
    .where(between(schema.datevBookings.date, yearStart(year), yearEnd(year)))
    .orderBy(asc(schema.datevBookings.date), asc(schema.archiveFiles.filename), asc(schema.datevBookings.row));
  if (bookings.length > 0) {
    yield {
      path: "lexoffice/datev-buchungen.csv",
      content: csv(
        [
          "Datum",
          "Umsatz",
          "Soll/Haben",
          "Währung",
          "Konto",
          "Gegenkonto",
          "BU-Schlüssel",
          "Belegfeld 1",
          "Belegfeld 2",
          "Buchungstext",
          "Beleglink",
          "Datei",
          "Zeile",
        ],
        bookings.map(({ booking: b, filename }) => [
          b.date,
          money(b.amount),
          b.side,
          b.currency,
          b.account,
          b.contraAccount,
          b.buKey,
          b.voucherField1,
          b.voucherField2,
          b.text,
          b.documentLink,
          filename,
          b.row,
        ]),
      ),
      compress: true,
    };
  }

  const originals = await db
    .select()
    .from(schema.archiveFiles)
    .where(eq(schema.archiveFiles.year, year))
    .orderBy(asc(schema.archiveFiles.kind), asc(schema.archiveFiles.filename));
  for (const file of originals) {
    const ext = /\.([A-Za-z0-9]{1,5})$/.exec(file.filename)?.[1]?.toLowerCase() ?? EXTENSIONS[file.mimeType] ?? "bin";
    const path = uniquePath(usedPaths, `lexoffice/originale/${file.kind}/${safeName(file.filename.replace(/\.[^.]+$/, ""), 80)}.${ext}`);
    try {
      yield { path, content: new Uint8Array(await loadFile(file.sha256)), compress: !/^(application\/(pdf|zip)|image\/)/.test(file.mimeType) };
    } catch (error) {
      problems.push(`Archivdatei ${file.filename}: nicht lesbar – ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Felder, die nie ins Archiv dürfen (das Audit-Log früher Versionen enthielt sie noch) */
const SECRET_KEYS = new Set(["ciphertext", "pin_ciphertext", "calendar_token_hash"]);

function withoutSecrets(table: string, value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).filter(([key]) => !SECRET_KEYS.has(key));
  // Vom Zertifikat nur die unkritischen Metadaten
  if (table === "elster_certificates") {
    return Object.fromEntries(entries.filter(([key]) => ["id", "filename", "valid_until", "active", "uploaded_at"].includes(key)));
  }
  return Object.fromEntries(entries);
}

const yearOfAudit = (year: number) => sql`${schema.auditLog.at} >= ${berlinStart(year)} and ${schema.auditLog.at} < ${berlinStart(year + 1)}`;

/** In der Reihenfolge der Hash-Kette; Nr. ist die laufende ID, Ketten-Nr. die Position in der Kette */
async function* auditCsv(year: number): AsyncGenerator<Uint8Array> {
  yield encoder.encode(
    BOM +
      csvLine([
        "Zeitpunkt",
        "Benutzer",
        "Tabelle",
        "Zeilen-ID",
        "Aktion",
        "Alter Wert (JSON)",
        "Neuer Wert (JSON)",
        "Nr.",
        "Ketten-Nr.",
        "Vorgänger-Hash",
        "Hash",
      ]),
  );
  let after = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(and(gt(schema.auditLog.seq, after), yearOfAudit(year)))
      .orderBy(asc(schema.auditLog.seq))
      .limit(1000);
    if (rows.length === 0) return;
    yield encoder.encode(
      rows
        .map((r) =>
          csvLine([
            iso(r.at),
            r.actor,
            r.tableName,
            r.rowId,
            r.action,
            json(withoutSecrets(r.tableName, r.oldValue)),
            json(withoutSecrets(r.tableName, r.newValue)),
            r.id,
            r.seq,
            r.prevHash.toString("hex"),
            r.rowHash.toString("hex"),
          ]),
        )
        .join(""),
    );
    after = rows.at(-1)!.seq;
  }
}

/** Kopf der Kette beim Erstellen und letzter Eintrag des Jahres, zum Aufbewahren außerhalb des Servers */
async function pruefwertText(year: number, now: Date): Promise<string> {
  const [head, [last]] = await Promise.all([
    chainHead(),
    db
      .select({ seq: schema.auditLog.seq, hash: schema.auditLog.rowHash })
      .from(schema.auditLog)
      .where(yearOfAudit(year))
      .orderBy(desc(schema.auditLog.seq))
      .limit(1),
  ]);
  return [
    `Prüfwert des Änderungsprotokolls`,
    ``,
    `Beim Erstellen dieses Archivs (${now.toISOString()}):`,
    head ? formatPruefwert(head) : "keiner",
    ``,
    `Letzter Eintrag des Jahres ${year}:`,
    last ? formatPruefwert({ seq: last.seq, hash: last.hash.toString("hex") }) : "keiner",
    ``,
    `In Haben unter Einstellungen → Export → Änderungsprotokoll prüfen einfügen und vergleichen.`,
    `Stimmt der Wert, sind Audit-Log und festgeschriebene Daten bis zu diesem Eintrag unverändert.`,
    ``,
  ].join("\n");
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

function readme(year: number, now: Date, company: typeof schema.company.$inferSelect | undefined): string {
  const created = new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "medium", timeZone: "Europe/Berlin" }).format(now);
  return `Haben – Jahresarchiv ${year}
${"=".repeat(21 + String(year).length)}

Firma:          ${company?.name || "–"}${company?.steuernummer ? `, Steuernummer ${company.steuernummer}` : ""}
Zeitraum:       01.01.${year} bis 31.12.${year}
Erstellt:       ${created} (${now.toISOString()})
Haben-Version:  ${HABEN_VERSION}

Dieses Archiv enthält alle Rechnungen, Belege, Buchungen, Bankumsätze und
Umsatzsteuer-Voranmeldungen des Jahres ${year}, wie sie in Haben gespeichert sind.
Zugeordnet wird nach Datum: Rechnungen nach Rechnungsdatum, Belege nach Belegdatum
(ohne Datum nach Tag des Hochladens), Buchungen nach Buchungsdatum, Bankumsätze nach
Buchungstag, Voranmeldungen nach Zeitraum, das Protokoll nach Zeitpunkt der Änderung.


INHALT

rechnungen/              Festgeschriebene Ausgangsrechnungen als PDF und E-Rechnungs-XML
                         (bei ZUGFeRD steckt das XML zusätzlich im PDF), dazu
                         rechnungen.csv mit Beträgen und SHA-256 aus der Festschreibung.
                         Entwürfe ohne Rechnungsnummer sind nicht enthalten. Nur wenn
                         vorhanden: zusätzliche Anhänge der Rechnungen unter anhaenge/,
                         Name: Nummer_Dateiname, mit anhaenge.csv.
angebote/                Nur wenn vorhanden: festgeschriebene Angebote des Jahres als PDF,
                         angebote.csv mit Antwort des Kunden und daraus entstandener
                         Rechnung. Nur wenn vorhanden: zusätzliche Anhänge der Angebote
                         unter anhaenge/, Name: Nummer_Dateiname, mit anhaenge.csv.
belege/                  Eingangsrechnungen und Quittungen als Originaldatei,
                         Name: Datum_Lieferant_Kurz-ID; belege.csv mit Beträgen je
                         Steuersatz, Status, Storno (Datum und Grund), SHA-256 und
                         ursprünglichem Dateinamen.
belege/verrechnungen.csv Nur wenn vorhanden: Verrechnungen zweier Eingangsbelege ohne
                         Zahlung (etwa eine Gutschrift gegen eine Rechnung), je
                         Verrechnung beide Seiten mit Datum, Betrag und Grund;
                         aufgehobene als Gegenzeile.
buchungen/journal.csv    Journal, eine Zeile je Buchungszeile (Konto, Soll, Haben,
                         Steuerschlüssel, Bemessungsgrundlage bei Ist-Versteuerung an
                         der Zahlung); Stornos verweisen auf die Ursprungsbuchung.
anlagen/anlagenverzeichnis.csv
                         Anlagenverzeichnis des Jahres: Anschaffung, Buchwert am
                         Jahresanfang, Zugang, AfA, Abgang und Buchwert am Jahresende.
pauschalen/pauschalen.csv
                         Nur wenn vorhanden: Pauschalen ohne Beleg (Homeoffice-Tage,
                         Fahrten, Verpflegungsmehraufwand) mit ihren Angaben als
                         Eigenbeleg; Stornos als Gegenzeile.
kasse/kassenbuch.csv     Nur wenn vorhanden: Kassenbuch des Jahres mit fortlaufender
                         Nummer, Anfangsbestand und Bestand nach jeder Zeile; bei
                         Bareinnahmen auf Rechnungen die Rechnungsnummer.
bank/<IBAN>/umsaetze.csv Importierte Kontoumsätze je Konto (Zahlungsdienstleister unter ihrem Namen).
bank/zuordnungen.csv     Zuordnungen der Umsätze zu Rechnungen, Belegen und Buchungen
                         ohne Beleg; aufgehobene Zuordnungen als Gegenzeile.
bank/verrechnungen.csv   Nur wenn vorhanden: miteinander verrechnete gegenläufige Umsätze
                         (etwa Kartenprüfung und Rückbuchung) mit Notiz, ohne Buchung;
                         aufgehobene als Gegenzeile.
bank/ausbuchungen.csv    Nur wenn vorhanden: ausgebuchte Reste von Rechnungen und Belegen
                         (Skonto, Forderungsausfall); aufgehobene als Gegenzeile; bei
                         Skonto zu einer Bareinnahme die Nummer im Kassenbuch.
bank/importe.csv         Importierte Kontoauszugsdateien mit SHA-256, Zeitraum und Salden.
                         Die Auszugsdateien selbst speichert Haben nicht.
umsatzsteuer/<JJJJ-MM>/  Voranmeldung mit den gespeicherten Kennzahlen (anmeldung.json),
                         jede Prüfung und Übermittlung (übermittlungen.csv) mit
                         ERiC-Protokoll (PDF) und gesendetem bzw. empfangenem XML;
                         bei einer Abgabe außerhalb von Haben der Vermerk mit dem
                         Übermittlungsprotokoll aus Mein ELSTER (PDF).
stammdaten/              Kontakte (aktueller Stand und alle Versionen), Bankkonten und
                         Firmendaten. Das ELSTER-Zertifikat ist absichtlich nicht enthalten.
lexoffice/               Nur bei übernommenem Altbestand: Rechnungen und Belege aus
                         Lexware Office, sevDesk oder BuchhaltungsButler (Spalte Quelle;
                         bei sevDesk steht in Lexoffice-ID die sevDesk-Art und -ID, z. B. invoice/123) mit
                         Originaldateien (belege.csv), Einzelzahlungen aus sevDesk
                         (zahlungen.csv), die Zeilen des
                         DATEV-Buchungsstapels (datev-buchungen.csv) und die unveränderten
                         Originalexporte des Jahres (originale/: DATEV, IDEA,
                         ELSTER-Protokolle, Kontoauszüge, Finanzberichte der
                         App-Stores).
protokoll/audit.csv      Änderungsprotokoll des Jahres mit altem und neuem Wert, in der
                         Reihenfolge der Hash-Kette mit Vorgänger-Hash und Hash je Eintrag.
protokoll/pruefwert.txt  Prüfwert (Kopf der Hash-Kette) beim Erstellen des Archivs und am
                         Ende des Jahres.
pruefsummen.sha256       SHA-256 jeder Datei in diesem Archiv.


ORIGINALE

PDF-, XML- und Bilddateien sind byte-genau die gespeicherten Originale, unverändert.
Die SHA-256-Werte in rechnungen.csv und belege.csv wurden beim Festschreiben bzw.
Hochladen berechnet und müssen zu den Dateien passen.


ÄNDERUNGSPROTOKOLL

Jeder Eintrag im Audit-Log ist mit seinem Vorgänger verkettet: Hash = SHA-256 aus
Vorgänger-Hash und Inhalt. Festgeschriebene Buchungen, Rechnungen, Belege,
Voranmeldungen und die Zeilen von Kassenbuch, Zuordnungen, Pauschalen und AfA
tragen ein Siegel über ihren Inhalt, das selbst im Protokoll steht.
Geprüft wird beides in Haben (Einstellungen → Export → Änderungsprotokoll prüfen).
Den Prüfwert aus protokoll/pruefwert.txt außerhalb des Servers aufbewahren: Er zeigt
später, ob das Protokoll bis zu diesem Eintrag nachträglich verändert wurde. Die Kette
verhindert keine Änderung, sie macht sie sichtbar. Geheimnisse (Zugangsdaten) sind
in audit.csv entfernt; den Hash eines Eintrags nachrechnen kann daher nur Haben.


PRÜFSUMMEN PRÜFEN

Nach dem Entpacken im Archivordner:
  Linux:    sha256sum -c pruefsummen.sha256
  macOS:    shasum -a 256 -c pruefsummen.sha256
  Windows:  Get-FileHash -Algorithm SHA256 <Datei>   (PowerShell, einzeln vergleichen)


CSV-DATEIEN

UTF-8 mit BOM, Trennzeichen Semikolon, Beträge in Euro mit Dezimalkomma (1234,56),
Datumsangaben als JJJJ-MM-TT, Zeitpunkte in UTC (ISO 8601). Felder mit Semikolon,
Anführungszeichen oder Zeilenumbruch stehen in Anführungszeichen.


AUFBEWAHRUNG

Nach § 147 AO und den GoBD sind Bücher, Aufzeichnungen und Buchungsbelege
aufzubewahren: Bücher und Aufzeichnungen 10 Jahre, Buchungsbelege seit 2025 8 Jahre,
Handels- und Geschäftsbriefe 6 Jahre. Die Frist beginnt mit dem Ende des
Kalenderjahrs, hier also am 31.12.${year}. Am einfachsten bewahrst du das ganze Archiv
10 Jahre auf, bis mindestens 31.12.${year + 10}, unverändert und lesbar, zum Beispiel
zusätzlich zum Backup auf einem zweiten Datenträger. Elektronisch empfangene Rechnungen
(E-Rechnungen) müssen elektronisch aufbewahrt werden; ein Ausdruck reicht nicht.
`;
}
