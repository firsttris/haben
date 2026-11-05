import type { z } from "zod";
import {
  bookingIssues,
  documentCancellation,
  documentFileProblem,
  getDocument,
  listDocuments,
  MAX_DOCUMENT_SIZE,
  uploadDocument,
  type DocumentReference,
} from "../belege/index.ts";
import { fail, notFound, ok, validate, type ApiRequest, type ApiResult } from "./http.ts";
import { documentQuerySchema, documentUploadSchema, type documentSchema, type documentSummarySchema } from "./schemas.ts";

/*
 * Belege über die REST-API (#104): eigene Werkzeuge, Dokumentenarchive und Skripte liefern Eingangsbelege, die wie beim
 * Upload unter Belege als „Zu prüfen“ landen; dazu lesen sie den Stand. Prüfen, Buchen, Ändern und Löschen bleiben in
 * Haben, auf die Seite zeigt `url` in jeder Antwort.
 */

type ListRow = Omit<Awaited<ReturnType<typeof listDocuments>>[number], "splitCount">;
type Loaded = NonNullable<Awaited<ReturnType<typeof getDocument>>> & Awaited<ReturnType<typeof documentCancellation>>;

const DOCUMENT_NOT_FOUND = "Beleg nicht gefunden.";
const location = (id: string) => `/api/v1/belege/${id}`;

/** KI-Auslesung läuft nach der Antwort weiter, wie beim Upload in Haben; Fehler landen am Beleg */
const inBackground = (work: Promise<void>) => void work.catch((error: unknown) => console.error("Belegauslesung", error));

function summaryOut(row: ListRow, baseUrl: string): z.output<typeof documentSummarySchema> {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    status: row.status,
    booked: row.lockedAt !== null,
    extractionStatus: row.extractionStatus,
    supplierName: row.supplierName,
    invoiceNumber: row.invoiceNumber,
    documentDate: row.documentDate,
    category: row.category,
    currency: row.currency,
    gross: row.gross,
    externalSource: row.externalSource,
    externalId: row.externalId,
    uploadedAt: row.uploadedAt.toISOString(),
    bookedAt: row.lockedAt?.toISOString() ?? null,
    cancelledOn: row.cancelledOn,
    url: `${baseUrl}/belege/${row.id}`,
  };
}

function documentOut({ document, amounts, splits, cancellation, reentryId }: Loaded, request: ApiRequest): z.output<typeof documentSchema> {
  return {
    ...summaryOut({ ...document, cancelledOn: cancellation?.date ?? null }, request.baseUrl),
    size: document.size,
    extractedBy: document.extractedBy,
    extractionError: document.extractionError,
    supplierUstId: document.supplierUstId,
    dueDate: document.dueDate,
    payment: document.payment,
    note: document.note,
    net: document.net,
    tax: document.tax,
    amounts: amounts.map(({ taxRate, net, tax }) => ({ taxRate, net, tax })),
    issues: document.lockedAt ? [] : bookingIssues(document, amounts, request.today, splits),
    replacedById: reentryId,
    replacesId: document.replacesDocumentId,
    updatedAt: document.updatedAt.toISOString(),
  };
}

/** Beleg mit Beträgen und Storno */
async function load(id: string): Promise<Loaded | null> {
  const loaded = await getDocument(id);
  return loaded && { ...loaded, ...(await documentCancellation(id)) };
}

async function respondWith(id: string, request: ApiRequest, status = 200, headers: Record<string, string> = {}): Promise<ApiResult> {
  const loaded = await load(id);
  if (!loaded) return notFound(DOCUMENT_NOT_FOUND);
  return ok(documentOut(loaded, request), status, headers);
}

export async function listDocumentsHandler(request: ApiRequest): Promise<ApiResult> {
  const query = validate(documentQuerySchema, request.query);
  if ("failure" in query) return query.failure;
  const { status, externalSource, externalId, limit, offset } = query.data;
  const rows = (await listDocuments()).filter(
    (row) => (!status || row.status === status) && (!externalSource || row.externalSource === externalSource) && (!externalId || row.externalId === externalId),
  );
  return ok({ data: rows.slice(offset, offset + limit).map((row) => summaryOut(row, request.baseUrl)), total: rows.length, limit, offset });
}

export async function getDocumentHandler(request: ApiRequest): Promise<ApiResult> {
  return respondWith(request.params.id!, request);
}

const sameReference = (document: Loaded["document"], reference: DocumentReference | null) =>
  reference === null || (document.externalSource === reference.externalSource && document.externalId === reference.externalId);

/**
 * Dieselbe Datei gibt es schon (Ablage nach SHA-256, ein Beleg je Datei). Ohne Referenz oder mit derselben ist das der
 * gewünschte Beleg: 200 wie beim Upload in Haben, der „schon vorhanden“ meldet. Mit einer anderen Referenz nicht: Ein
 * Werkzeug würde sich sonst den Beleg zu einem anderen Dokument merken, deshalb 409 mit dem vorhandenen Beleg.
 */
async function existing(id: string, reference: DocumentReference | null, request: ApiRequest): Promise<ApiResult> {
  const loaded = await load(id);
  if (!loaded) return notFound(DOCUMENT_NOT_FOUND);
  if (sameReference(loaded.document, reference)) return ok(documentOut(loaded, request), 200, { Location: location(id) });
  const { externalSource, externalId } = loaded.document;
  const known = externalSource ? `mit der Referenz ${externalSource}/${externalId}` : "ohne Referenz";
  return fail("conflict", `Diese Datei liegt in Haben schon als Beleg ${id} ${known} vor. Jede Datei gibt es nur einmal.`, {
    existingId: id,
    headers: { Location: location(id) },
  });
}

/** Neuer Beleg wie beim Upload unter Belege; mit externer Referenz idempotent */
export async function createDocumentHandler(request: ApiRequest): Promise<ApiResult> {
  const input = validate(documentUploadSchema, request.body);
  if ("failure" in input) return input.failure;
  const { datei, note, externalSource, externalId } = input.data;
  const filename = datei.name || "beleg";
  // Vor dem Einlesen, wie beim Upload in Haben
  if (datei.size > MAX_DOCUMENT_SIZE) return fail("payload_too_large", `${filename}: größer als ${MAX_DOCUMENT_SIZE / 1024 / 1024} MB.`);
  const file = { bytes: new Uint8Array(await datei.arrayBuffer()), filename };
  const problem = documentFileProblem(file);
  if (problem?.kind === "format") return fail("unsupported_media_type", problem.message);
  if (problem) return fail("validation_failed", problem.message, { issues: [{ path: "datei", message: problem.message }] });

  const reference = externalSource && externalId ? { externalSource, externalId } : null;
  const { id, duplicate } = await uploadDocument(request.actor, file, { background: inBackground, note, ...(reference ? { reference } : {}) });
  if (duplicate) return existing(id, reference, request);
  return respondWith(id, request, 201, { Location: location(id) });
}
