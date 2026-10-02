import { createHash } from "node:crypto";
import { and, asc, between, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import pkg from "../../package.json" with { type: "json" };
import { db, schema } from "./db/index.ts";
import { accountName } from "./functions/journal.ts";
import { loadFile } from "./storage.ts";
import { today } from "./today.ts";

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
  const text = typeof value === "boolean" ? (value ? "ja" : "nein") : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: CsvValue[]): string {
  return values.map(csvField).join(";") + "\r\n";
}

const encoder = new TextEncoder();
const BOM = "﻿";

export function csv(header: string[], rows: CsvValue[][]): Uint8Array {
  return encoder.encode(BOM + csvLine(header) + rows.map(csvLine).join(""));
}

/** Cent als Dezimalzahl mit Komma, ohne Tausenderpunkt: 123456 → "1234,56" */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
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
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else if (chunk.length > 0) queue.push(chunk);
  });
  function* drain(): Generator<Uint8Array> {
    if (failure) throw failure;
    while (queue.length > 0) yield queue.shift()!;
  }

  const checksums: string[] = [];
  const add = async function* (file: ArchiveFile): AsyncGenerator<Uint8Array> {
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
  yield* add({ path: CHECKSUM_FILE, content: encoder.encode(checksums.join("\n") + "\n"), compress: true });
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

const KIND_LABELS: Record<string, string> = { rechnung: "Rechnung", storno: "Stornorechnung", korrektur: "Rechnungskorrektur" };
const FORMAT_LABELS: Record<string, string> = { zugferd: "ZUGFeRD", "xrechnung-cii": "XRechnung (CII)", "xrechnung-ubl": "XRechnung (UBL)" };
const SOURCE_LABELS: Record<string, string> = { invoice: "Rechnung", document: "Beleg", allocation: "Zahlung" };
const ALLOCATION_LABELS: Record<string, string> = {
  invoice: "Rechnung",
  document: "Beleg",
  privat: "Privat",
  geldtransit: "Geldtransit",
  ustVorauszahlung: "USt-Vorauszahlung",
  gebuehren: "Bankgebühren",
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
    union select extract(year from booking_date)::int from bank_transactions
    union select year::int from vat_returns
    union select extract(year from date)::int from lexoffice_vouchers
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
      format: schema.invoices.format,
      lockedAt: schema.invoices.lockedAt,
      pdfSha256: schema.invoices.pdfSha256,
      xmlSha256: schema.invoices.xmlSha256,
      correctsId: schema.invoices.correctsId,
    })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.status, "final"),
        gte(schema.invoices.issueDate, yearStart(year)),
        lte(schema.invoices.issueDate, yearEnd(year)),
      ),
    )
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
    const [files] = await db
      .select({ pdf: schema.invoices.pdf, xml: schema.invoices.xml })
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoice.id));
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
      KIND_LABELS[invoice.kind] ?? invoice.kind,
      invoice.issueDate,
      invoice.dueDate,
      invoice.serviceFrom,
      invoice.serviceTo,
      invoice.buyer?.name ?? "",
      money(invoice.net),
      money(invoice.tax),
      money(invoice.gross),
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
        "Nummer", "Art", "Datum", "Fällig", "Leistung von", "Leistung bis", "Kunde", "Netto", "USt", "Brutto", "Format",
        "Festgeschrieben", "SHA-256 PDF", "SHA-256 XML", "Storno/Korrektur von", "Datei PDF", "Datei XML", "ID",
      ],
      invoiceRows,
    ),
    compress: true,
  };

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
      net: schema.documents.net,
      tax: schema.documents.tax,
      gross: schema.documents.gross,
      lockedAt: schema.documents.lockedAt,
      uploadedAt: schema.documents.uploadedAt,
    })
    .from(schema.documents)
    .where(sql`${documentDay}::date between ${yearStart(year)}::date and ${yearEnd(year)}::date`)
    .orderBy(asc(documentDay), asc(schema.documents.uploadedAt), asc(schema.documents.id));

  const amounts = documents.length
    ? await db.select().from(schema.documentAmounts).where(inArray(schema.documentAmounts.documentId, documents.map((d) => d.id)))
    : [];
  const amountsByDocument = groupBy(amounts, (a) => a.documentId);
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
      doc.category,
      money(rate(1900)?.net),
      money(rate(1900)?.tax),
      money(rate(700)?.net),
      money(rate(700)?.tax),
      money(rate(0)?.net),
      money(doc.net),
      money(doc.tax),
      money(doc.gross),
      doc.currency,
      doc.payment === "privat" ? "privat" : "Bank",
      doc.status,
      iso(doc.lockedAt),
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
        "Datum", "Lieferant", "USt-IdNr.", "Rechnungsnummer", "Kategorie", "Netto 19 %", "Vorsteuer 19 %", "Netto 7 %",
        "Vorsteuer 7 %", "Netto 0 %", "Netto", "Vorsteuer", "Brutto", "Währung", "Zahlung", "Status", "Gebucht am", "Quelle",
        "Fällig", "Notiz", "SHA-256", "Originaldateiname", "Datei im Archiv", "Hochgeladen", "ID",
      ],
      documentRows,
    ),
    compress: true,
  };

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
        .where(inArray(schema.journalLines.entryId, entries.map((e) => e.id)))
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
      entry.reversesId,
      iso(entry.lockedAt),
      iso(entry.createdAt),
    ]),
  );
  yield {
    path: "buchungen/journal.csv",
    content: csv(
      [
        "Datum", "Buchungs-ID", "Beschreibung", "Quelle", "Quell-ID", "Kontenrahmen", "Konto", "Kontoname", "Soll", "Haben",
        "Steuerschlüssel", "Gegenbuchung zu", "Festgeschrieben", "Erfasst",
      ],
      journalRows,
    ),
    compress: true,
  };

  // Bank ------------------------------------------------------------------
  const accounts = await db.select().from(schema.bankAccounts).orderBy(asc(schema.bankAccounts.iban));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const transactions = await db
    .select()
    .from(schema.bankTransactions)
    .where(and(gte(schema.bankTransactions.bookingDate, yearStart(year)), lte(schema.bankTransactions.bookingDate, yearEnd(year))))
    .orderBy(asc(schema.bankTransactions.bookingDate), asc(schema.bankTransactions.createdAt), asc(schema.bankTransactions.id));
  const transactionById = new Map(transactions.map((t) => [t.id, t]));
  const allocations = transactions.length
    ? await db
        .select()
        .from(schema.allocations)
        .where(inArray(schema.allocations.transactionId, transactions.map((t) => t.id)))
        .orderBy(asc(schema.allocations.createdAt), asc(schema.allocations.id))
    : [];
  const imports = await db
    .select()
    .from(schema.bankImports)
    .where(
      sql`exists (select 1 from bank_transactions t where t.import_id = ${schema.bankImports.id}
            and t.booking_date between ${yearStart(year)}::date and ${yearEnd(year)}::date)
          or (${schema.bankImports.periodFrom} <= ${yearEnd(year)}::date and ${schema.bankImports.periodTo} >= ${yearStart(year)}::date)`,
    )
    .orderBy(asc(schema.bankImports.createdAt));
  const importById = new Map(imports.map((i) => [i.id, i]));

  const allocatedByTransaction = new Map<string, number>();
  for (const a of allocations) allocatedByTransaction.set(a.transactionId, (allocatedByTransaction.get(a.transactionId) ?? 0) + a.amount);

  const usedBankPaths = new Set<string>();
  for (const [accountId, rows] of groupBy(transactions, (t) => t.bankAccountId)) {
    const account = accountById.get(accountId);
    yield {
      path: uniquePath(usedBankPaths, `bank/${safeName(account?.iban ?? accountId, 40)}/umsaetze.csv`),
      content: csv(
        [
          "Buchungsdatum", "Wertstellung", "Betrag", "Währung", "Gegenpartei", "Gegen-IBAN", "Verwendungszweck", "Umsatztyp",
          "Bankreferenz", "Zugeordnet", "Offen", "Importdatei", "Umsatz-ID",
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
            money(t.amount - allocated),
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
          t ? accountById.get(t.bankAccountId)?.iban : "",
          ALLOCATION_LABELS[a.kind] ?? a.kind,
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
  yield {
    path: "bank/importe.csv",
    content: csv(
      ["Konto", "Datei", "SHA-256", "Format", "Zeitraum von", "Zeitraum bis", "Anfangssaldo", "Endsaldo", "Neu", "Übersprungen", "Hinweise", "Importiert", "Import-ID"],
      imports.map((i) => [
        accountById.get(i.bankAccountId)?.iban,
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
        .where(inArray(schema.vatReturnSubmissions.vatReturnId, vatReturns.map((r) => r.id)))
        .orderBy(asc(schema.vatReturnSubmissions.createdAt))
    : [];
  for (const [month, returns] of groupBy(vatReturns, (r) => r.month)) {
    const dir = `umsatzsteuer/${year}-${String(month).padStart(2, "0")}`;
    const submissionRows: CsvValue[][] = [];
    for (const [index, vatReturn] of returns.entries()) {
      const suffix = returns.length > 1 ? `-${index + 1}` : "";
      yield { path: `${dir}/anmeldung${suffix}.json`, content: encoder.encode(JSON.stringify(vatReturn, null, 2) + "\n"), compress: true };
      for (const submission of submissions.filter((s) => s.vatReturnId === vatReturn.id)) {
        const stem = `${submission.createdAt.toISOString().slice(0, 10)}_${submission.kind}_${submission.id.slice(0, 8)}`;
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
        for (const [key, label] of [["requestXml", "anfrage"], ["responseXml", "antwort"], ["serverResponseXml", "server-antwort"]] as const) {
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

  // Altbestand aus Lexoffice ---------------------------------------------------
  yield* legacyFiles(year, problems);

  // Stammdaten ------------------------------------------------------------
  const contacts = await db.select().from(schema.contacts).orderBy(asc(schema.contacts.name), asc(schema.contacts.id));
  yield {
    path: "stammdaten/kontakte.csv",
    content: csv(
      ["Kundennummer", "Name", "Straße", "PLZ", "Ort", "Land", "E-Mail", "USt-IdNr.", "IBAN", "Leitweg-ID", "Rechnungsformat", "Version", "Archiviert", "Angelegt", "Geändert", "ID"],
      contacts.map((c) => [
        c.kundennummer, c.name, c.strasse, c.plz, c.ort, c.land, c.email, c.ustId, c.iban, c.leitwegId, c.defaultFormat,
        c.version, iso(c.archivedAt), iso(c.createdAt), iso(c.updatedAt), c.id,
      ]),
    ),
    compress: true,
  };
  const versions = await db
    .select()
    .from(schema.contactVersions)
    .orderBy(asc(schema.contactVersions.contactId), asc(schema.contactVersions.version));
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
    content: csv(["Name", "IBAN", "Angelegt", "ID"], accounts.map((a) => [a.name, a.iban, iso(a.createdAt), a.id])),
    compress: true,
  };
  yield { path: "stammdaten/firma.json", content: encoder.encode(JSON.stringify(company ?? null, null, 2) + "\n"), compress: true };

  // Änderungsprotokoll, seitenweise gelesen ----------------------------------
  yield { path: "protokoll/audit.csv", content: auditCsv(year), compress: true };

  if (problems.length > 0) {
    yield { path: "FEHLER.txt", content: encoder.encode(`Beim Erstellen des Archivs fehlten Dateien:\n\n${problems.join("\n")}\n`), compress: true };
  }
}

const LEGACY_TYPE_LABELS: Record<string, string> = {
  invoice: "Rechnung",
  creditnote: "Gutschrift",
  downpaymentinvoice: "Abschlagsrechnung",
  salesinvoice: "Einnahmebeleg",
  salescreditnote: "Einnahme-Gutschrift",
  purchaseinvoice: "Ausgabebeleg",
  purchasecreditnote: "Ausgabe-Gutschrift",
};

/** Aus Lexoffice übernommene Belege, DATEV-Buchungen und Originalexporte des Jahres */
async function* legacyFiles(year: number, problems: string[]): AsyncGenerator<ArchiveFile> {
  const vouchers = await db
    .select()
    .from(schema.lexofficeVouchers)
    .where(between(schema.lexofficeVouchers.date, yearStart(year), yearEnd(year)))
    .orderBy(asc(schema.lexofficeVouchers.date), asc(schema.lexofficeVouchers.number), asc(schema.lexofficeVouchers.id));
  const files = vouchers.length
    ? await db
        .select()
        .from(schema.lexofficeVoucherFiles)
        .where(inArray(schema.lexofficeVoucherFiles.voucherId, vouchers.map((v) => v.id)))
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
        problems.push(`Lexoffice-Beleg ${voucher.number || voucher.id}: Datei ${file.filename} nicht lesbar – ${error instanceof Error ? error.message : String(error)}`);
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
    ]);
  }
  if (vouchers.length > 0) {
    yield {
      path: "lexoffice/belege.csv",
      content: csv(
        ["Datum", "Art", "Richtung", "Nummer", "Kontakt", "Netto", "Steuer", "Brutto", "Währung", "Status in Lexoffice", "Fällig", "Bezahlt am", "Steuersätze (JSON)", "Kategorien (JSON)", "Notiz", "Dateien", "SHA-256", "Lexoffice-ID"],
        rows,
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
        ["Datum", "Umsatz", "Soll/Haben", "Währung", "Konto", "Gegenkonto", "BU-Schlüssel", "Belegfeld 1", "Belegfeld 2", "Buchungstext", "Beleglink", "Datei", "Zeile"],
        bookings.map(({ booking: b, filename }) => [
          b.date, money(b.amount), b.side, b.currency, b.account, b.contraAccount, b.buKey, b.voucherField1, b.voucherField2, b.text,
          b.documentLink, filename, b.row,
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
const SECRET_KEYS = new Set(["ciphertext"]);

function withoutSecrets(table: string, value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).filter(([key]) => !SECRET_KEYS.has(key));
  // Vom Zertifikat nur die unkritischen Metadaten
  if (table === "elster_certificates") {
    return Object.fromEntries(entries.filter(([key]) => ["id", "filename", "valid_until", "active", "uploaded_at"].includes(key)));
  }
  return Object.fromEntries(entries);
}

async function* auditCsv(year: number): AsyncGenerator<Uint8Array> {
  yield encoder.encode(BOM + csvLine(["Zeitpunkt", "Benutzer", "Tabelle", "Zeilen-ID", "Aktion", "Alter Wert (JSON)", "Neuer Wert (JSON)", "Nr."]));
  let after = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          gt(schema.auditLog.id, after),
          sql`${schema.auditLog.at} >= ${berlinStart(year)} and ${schema.auditLog.at} < ${berlinStart(year + 1)}`,
        ),
      )
      .orderBy(asc(schema.auditLog.id))
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
          ]),
        )
        .join(""),
    );
    after = rows.at(-1)!.id;
  }
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
                         Entwürfe ohne Rechnungsnummer sind nicht enthalten.
belege/                  Eingangsrechnungen und Quittungen als Originaldatei,
                         Name: Datum_Lieferant_Kurz-ID; belege.csv mit Beträgen je
                         Steuersatz, Status, SHA-256 und ursprünglichem Dateinamen.
buchungen/journal.csv    Journal, eine Zeile je Buchungszeile (Konto, Soll, Haben,
                         Steuerschlüssel); Stornos verweisen auf die Ursprungsbuchung.
bank/<IBAN>/umsaetze.csv Importierte Kontoumsätze je Konto.
bank/zuordnungen.csv     Zuordnungen der Umsätze zu Rechnungen, Belegen und Buchungen
                         ohne Beleg; aufgehobene Zuordnungen als Gegenzeile.
bank/importe.csv         Importierte Kontoauszugsdateien mit SHA-256, Zeitraum und Salden.
                         Die Auszugsdateien selbst speichert Haben nicht.
umsatzsteuer/<JJJJ-MM>/  Voranmeldung mit den gespeicherten Kennzahlen (anmeldung.json),
                         jede Prüfung und Übermittlung (übermittlungen.csv) mit
                         ERiC-Protokoll (PDF) und gesendetem bzw. empfangenem XML.
stammdaten/              Kontakte (aktueller Stand und alle Versionen), Bankkonten und
                         Firmendaten. Das ELSTER-Zertifikat ist absichtlich nicht enthalten.
lexoffice/               Nur bei übernommenem Altbestand: Rechnungen und Belege aus
                         Lexware Office mit Originaldateien (belege.csv), die Zeilen des
                         DATEV-Buchungsstapels (datev-buchungen.csv) und die unveränderten
                         Originalexporte des Jahres (originale/: DATEV, IDEA,
                         ELSTER-Protokolle, Kontoauszüge).
protokoll/audit.csv      Änderungsprotokoll des Jahres mit altem und neuem Wert.
pruefsummen.sha256       SHA-256 jeder Datei in diesem Archiv.


ORIGINALE

PDF-, XML- und Bilddateien sind byte-genau die gespeicherten Originale, unverändert.
Die SHA-256-Werte in rechnungen.csv und belege.csv wurden beim Festschreiben bzw.
Hochladen berechnet und müssen zu den Dateien passen.


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
