import { formatExchangeRate, isKapitalgesellschaft } from "@haben/core";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { loadFile } from "../../storage.ts";
import { splitsByDocument } from "../belege/index.ts";
import { loadOwnAccountNumbers } from "../eigene-konten/index.ts";
import { csv, type CsvValue, iso, money } from "./csv.ts";
import { EXTENSIONS, safeName, uniquePath } from "./export-paths.ts";
import { RECHNUNGSVERRECHNUNGEN_HEADER, rechnungsVerrechnungenFuerArchiv, VERRECHNUNGEN_HEADER, verrechnungenFuerArchiv } from "./export-verrechnung.ts";
import type { ArchiveFile } from "./export-zip.ts";
import { groupBy } from "./group-by.ts";
import { yearEnd, yearStart } from "./jahr.ts";

// Belege des Jahresarchivs und die Verrechnungen von Belegen und Rechnungen

type ArchiveDocument = Awaited<ReturnType<typeof documentsOfYear>>[number];

/** Belegdatum, ohne Datum der Tag des Hochladens */
const documentDaySql = () => sql<string>`coalesce(${schema.documents.documentDate}, (${schema.documents.uploadedAt} at time zone 'Europe/Berlin')::date)::text`;

/**
 * Belege des Jahres mit belege.csv und den Verrechnungsdateien; gibt den Archivpfad je Beleg-ID zurück, auf den die
 * Bankdateien verweisen
 */
export async function* documentFiles(
  year: number,
  company: typeof schema.company.$inferSelect | undefined,
  problems: string[],
  invoiceNumbers: Map<string, string | null>,
): AsyncGenerator<ArchiveFile, Map<string, string>> {
  const documents = await documentsOfYear(year);
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
  // Eigene Sachkonten (#270): Nummer am Beleg bzw. je Zeile der Aufteilung (account), zusätzlich zur Kategorie
  const ownNumbers = await loadOwnAccountNumbers();
  const splits = await splitsByDocument(
    documents.map((d) => d.id),
    db,
    ownNumbers,
  );
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
    documentRows.push(documentRow(doc, amountsByDocument.get(doc.id) ?? [], splits.get(doc.id) ?? [], ownNumbers, company, bytes ? path : null));
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
        "Eigenes Konto",
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
  yield* settlementFiles(year, documentPaths, invoiceNumbers);
  return documentPaths;
}

async function documentsOfYear(year: number) {
  const documentDay = documentDaySql();
  return db
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
      ownAccountId: schema.documents.ownAccountId,
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
}

/** Zeile der belege.csv; archivePath ist null, wenn die Datei fehlt */
function documentRow(
  doc: ArchiveDocument,
  docAmounts: (typeof schema.documentAmounts.$inferSelect)[],
  split: Awaited<ReturnType<typeof splitsByDocument>> extends Map<string, infer L> ? L : never,
  ownNumbers: Map<string, string>,
  company: typeof schema.company.$inferSelect | undefined,
  archivePath: string | null,
): CsvValue[] {
  const rate = (r: number) => docAmounts.find((a) => a.taxRate === r);
  return [
    doc.documentDate,
    doc.supplierName,
    doc.supplierUstId,
    doc.invoiceNumber,
    // Aufgeteilt (#271): Kategorie, Satz und Netto je Zeile, z. B. „wareneinkauf 19 % 100,00 | software 19 % 50,00“
    doc.category ?? split.map((l) => `${l.category} ${l.taxRate / 100} % ${money(l.net)}`).join(" | "),
    // Eigenes Konto: am Beleg die Nummer, bei einer Aufteilung je Zeile in derselben Reihenfolge wie die Kategorien, leer ohne eigenes Konto
    doc.ownAccountId ? (ownNumbers.get(doc.ownAccountId) ?? "") : split.some((l) => l.account) ? split.map((l) => l.account ?? "–").join(" | ") : "",
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
    archivePath ? archivePath.replace(/^belege\//, "") : "FEHLT",
    iso(doc.uploadedAt),
    doc.id,
  ];
}

/** Verrechnungen zweier Eingangsbelege (#274) und einer Ausgangsrechnung mit einer Kundenkorrektur (#877), siehe export-verrechnung.ts */
async function* settlementFiles(year: number, documentPaths: Map<string, string>, invoiceNumbers: Map<string, string | null>): AsyncGenerator<ArchiveFile> {
  const documentDay = documentDaySql();
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

  const rechnungsVerrechnungen = await rechnungsVerrechnungenFuerArchiv(invoiceNumbers, {
    documentDay,
    von: yearStart(year),
    bis: yearEnd(year),
    safeName,
    extension: (mimeType) => EXTENSIONS[mimeType] ?? "bin",
    money,
    iso,
  });
  if (rechnungsVerrechnungen) {
    yield { path: "rechnungen/verrechnungen.csv", content: csv(RECHNUNGSVERRECHNUNGEN_HEADER, rechnungsVerrechnungen), compress: true };
  }
}
