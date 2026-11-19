import { asc, between, eq, getTableColumns, inArray } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { ohneJit } from "../../db/ohne-jit.ts";
import { loadFile } from "../../storage.ts";
import { effectiveAmount, effectiveContactName, effectiveDirection, effectivePayment, effectiveTaxes, effectiveType } from "../auswertungen/index.ts";
import { csv, type CsvValue, json, money } from "./csv.ts";
import { FILE_STATE_LABELS, FILE_STATUS_LABELS, fileStatesForYear, latestFileStates, legacyFileStatus } from "./dateistand.ts";
import { EXTENSIONS, safeName, uniquePath } from "./export-paths.ts";
import type { ArchiveFile } from "./export-zip.ts";
import { groupBy } from "./group-by.ts";
import { yearEnd, yearStart } from "./jahr.ts";

// Altbestand im Jahresarchiv: übernommene Belege, Zahlungen, DATEV-Buchungen, Originalexporte und Auftragskopien

const encoder = new TextEncoder();

const LEGACY_SOURCE_LABELS = {
  lexoffice: "Lexoffice",
  sevdesk: "sevDesk",
  buchhaltungsbutler: "BuchhaltungsButler",
  accountable: "Accountable",
  wiso: "WISO",
  import: "JSON-Import",
  fastbill: "FastBill",
  "sevdesk-export": "sevDesk-Export",
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
export async function* orderFiles(year: number, problems: string[]): AsyncGenerator<ArchiveFile> {
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

/** Übernommene Belege aus Lexoffice, sevDesk und den anderen Quellen samt Dateistand, Zahlungen, DATEV-Stapel und Originalen */
export async function* legacyFiles(year: number, problems: string[]): AsyncGenerator<ArchiveFile> {
  const usedPaths = new Set<string>();
  yield* voucherArchiveFiles(year, problems, usedPaths);
  for (const file of [fileStatesFile, paymentsFile, datevBookingsFile]) {
    const content = await file(year);
    if (content) yield content;
  }
  yield* originalFiles(year, problems, usedPaths);
}

/** Ausdrücke über alle Archivbelege: mit JIT dauerte schon das Kompilieren Sekunden (ohne-jit.ts) */
async function vouchersOfYear(year: number) {
  return ohneJit((tx) =>
    tx
      .select({
        ...getTableColumns(schema.lexofficeVouchers),
        type: effectiveType("lexoffice_vouchers"),
        direction: effectiveDirection("lexoffice_vouchers"),
        contactName: effectiveContactName("lexoffice_vouchers"),
        taxes: effectiveTaxes("lexoffice_vouchers"),
        net: effectiveAmount("lexoffice_vouchers", "net"),
        tax: effectiveAmount("lexoffice_vouchers", "tax"),
        gross: effectiveAmount("lexoffice_vouchers", "gross"),
        payment: effectivePayment("lexoffice_vouchers"),
      })
      .from(schema.lexofficeVouchers)
      .where(between(schema.lexofficeVouchers.date, yearStart(year), yearEnd(year)))
      .orderBy(asc(schema.lexofficeVouchers.date), asc(schema.lexofficeVouchers.number), asc(schema.lexofficeVouchers.id)),
  );
}

/** Übernommene Belege des Jahres mit ihren Dateien und lexoffice/belege.csv */
async function* voucherArchiveFiles(year: number, problems: string[], usedPaths: Set<string>): AsyncGenerator<ArchiveFile> {
  const vouchers = await vouchersOfYear(year);
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
  const fileStates = await latestFileStates(vouchers.map((v) => v.id));
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
    rows.push(voucherRow(voucher, paths, filesByVoucher.get(voucher.id) ?? [], fileStates.get(voucher.id) ?? null));
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
          "Dateistand",
        ],
        rows,
      ),
      compress: true,
    };
  }
}

/** Zeile der lexoffice/belege.csv */
function voucherRow(
  voucher: Awaited<ReturnType<typeof vouchersOfYear>>[number],
  paths: string[],
  voucherFiles: (typeof schema.lexofficeVoucherFiles.$inferSelect)[],
  fileState: Parameters<typeof legacyFileStatus>[0],
): CsvValue[] {
  return [
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
    voucherFiles.map((f) => f.sha256).join(" | "),
    voucher.lexofficeId,
    LEGACY_SOURCE_LABELS[voucher.source],
    FILE_STATUS_LABELS[legacyFileStatus(fileState, voucherFiles.length, voucher.raw.ohneBeleg === true)],
  ];
}

/** Verlauf des Dateistands (#345): was fehlte, warum, wer ohne Datei bestätigt hat und was nachgeladen wurde */
async function fileStatesFile(year: number): Promise<ArchiveFile | null> {
  const states = await fileStatesForYear(year);
  if (states.length === 0) return null;
  return {
    path: "lexoffice/dateistand.csv",
    content: csv(
      ["Zeitpunkt", "Belegnummer", "Beleg-ID der Quelle", "Stand", "Datei", "Datei-ID der Quelle", "Grund oder Herkunft", "Abruf", "Benutzer-ID"],
      states.map((r) => [
        r.createdAt.toISOString(),
        r.number,
        r.lexofficeId,
        FILE_STATE_LABELS[r.state],
        r.role ?? "",
        r.sourceFileId ?? "",
        r.message,
        r.importId ?? "",
        r.importId ? "" : r.createdBy,
      ]),
    ),
    compress: true,
  };
}

/** Einzelzahlungen nach Zahlungsdatum, also im Jahr des Geldflusses; der Beleg kann in einem anderen Jahr liegen */
async function paymentsFile(year: number): Promise<ArchiveFile | null> {
  const payments = await db
    .select({ payment: schema.legacyVoucherPayments, number: schema.lexofficeVouchers.number, voucher: schema.lexofficeVouchers.lexofficeId })
    .from(schema.legacyVoucherPayments)
    .innerJoin(schema.lexofficeVouchers, eq(schema.lexofficeVouchers.id, schema.legacyVoucherPayments.voucherId))
    .where(between(schema.legacyVoucherPayments.date, yearStart(year), yearEnd(year)))
    .orderBy(asc(schema.legacyVoucherPayments.date), asc(schema.lexofficeVouchers.number), asc(schema.legacyVoucherPayments.externalId));
  if (payments.length === 0) return null;
  return {
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

/** Übernommene DATEV-Buchungsstapel des Jahres */
async function datevBookingsFile(year: number): Promise<ArchiveFile | null> {
  const bookings = await db
    .select({ booking: schema.datevBookings, filename: schema.archiveFiles.filename })
    .from(schema.datevBookings)
    .innerJoin(schema.archiveFiles, eq(schema.archiveFiles.id, schema.datevBookings.fileId))
    .where(between(schema.datevBookings.date, yearStart(year), yearEnd(year)))
    .orderBy(asc(schema.datevBookings.date), asc(schema.archiveFiles.filename), asc(schema.datevBookings.row));
  if (bookings.length === 0) return null;
  return {
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

/** Originalexporte des Jahres aus den Quellen */
async function* originalFiles(year: number, problems: string[], usedPaths: Set<string>): AsyncGenerator<ArchiveFile> {
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
