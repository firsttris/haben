import type { z } from "zod";
import {
  createDraftForReference,
  createDraft,
  deleteDraft,
  draftInputOf,
  draftSchema,
  getInvoice,
  listInvoices,
  newDraftDefaults,
  updateDraft,
  type Invoice,
  type InvoiceLine,
} from "../rechnungen/index.ts";
import { getContact } from "../stammdaten/index.ts";
import { fail, noContent, notFound, ok, validate, type ApiRequest, type ApiResult } from "./http.ts";
import { draftCreateSchema, draftPatchSchema, invoiceQuerySchema, type invoiceSchema, type invoiceSummarySchema } from "./schemas.ts";

/*
 * Rechnungen über die REST-API: alle lesen, Entwürfe anlegen, ändern und löschen. Festschreiben, Buchen, Stornieren
 * und Versenden gibt es hier nicht; das bleibt wegen GoBD ein Klick in Haben, auf den `url` in jeder Antwort zeigt.
 */

type Summary = z.output<typeof invoiceSummarySchema>;
type ListRow = Awaited<ReturnType<typeof listInvoices>>[number];

const INVOICE_NOT_FOUND = "Rechnung nicht gefunden.";
const LOCKED = "Die Rechnung ist festgeschrieben und kann über die API nicht geändert oder gelöscht werden. Korrekturen gehen in Haben per Storno.";

function summaryOut(row: ListRow, baseUrl: string): Summary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    listStatus: row.listStatus,
    number: row.number,
    contactId: row.contactId,
    customer: row.customer,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    net: row.net,
    gross: row.gross,
    paid: row.paid,
    open: row.open,
    externalSource: row.externalSource,
    externalId: row.externalId,
    url: `${baseUrl}/rechnungen/${row.id}`,
  };
}

function invoiceOut(row: ListRow, invoice: Invoice, lines: InvoiceLine[], baseUrl: string): z.output<typeof invoiceSchema> {
  return {
    ...summaryOut(row, baseUrl),
    correctsId: invoice.correctsId,
    serviceFrom: invoice.serviceFrom,
    serviceTo: invoice.serviceTo,
    paymentTermDays: invoice.paymentTermDays,
    format: invoice.format,
    intro: invoice.intro,
    note: invoice.note,
    language: invoice.language,
    taxTreatment: invoice.taxTreatment,
    exemptionReason: invoice.exemptionReason,
    priceMode: invoice.priceMode,
    currency: invoice.currency,
    exchangeRate: invoice.exchangeRate,
    tax: invoice.tax,
    lines: lines.map(({ position, description, detail, quantity, unit, unitPrice, taxRate, net }) => ({
      position,
      description,
      detail,
      quantity,
      unit,
      unitPrice,
      taxRate,
      net,
    })),
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
    lockedAt: invoice.lockedAt?.toISOString() ?? null,
  };
}

/** Rechnung mit Positionen und Stand aus der Rechnungsliste, oder null */
async function loadInvoice(id: string, today: string) {
  const [detail, [row]] = await Promise.all([getInvoice(id), listInvoices(today, id)]);
  return detail && row ? { ...detail, row } : null;
}

async function respondWith(id: string, request: ApiRequest, status = 200, headers: Record<string, string> = {}): Promise<ApiResult> {
  const loaded = await loadInvoice(id, request.today);
  if (!loaded) return notFound(INVOICE_NOT_FOUND);
  return ok(invoiceOut(loaded.row, loaded.invoice, loaded.lines, request.baseUrl), status, headers);
}

async function contactProblem(contactId: string | null | undefined): Promise<ApiResult | null> {
  if (!contactId || (await getContact(contactId))) return null;
  return fail("unprocessable", "Kontakt nicht gefunden. Erst über /kontakte anlegen.");
}

export async function listInvoicesHandler(request: ApiRequest): Promise<ApiResult> {
  const query = validate(invoiceQuerySchema, request.query);
  if ("failure" in query) return query.failure;
  const { status, kind, contactId, externalSource, externalId, limit, offset } = query.data;
  const rows = (await listInvoices(request.today)).filter(
    (row) =>
      (!status || row.status === status) &&
      (!kind || row.kind === kind) &&
      (!contactId || row.contactId === contactId) &&
      (!externalSource || row.externalSource === externalSource) &&
      (!externalId || row.externalId === externalId),
  );
  return ok({ data: rows.slice(offset, offset + limit).map((row) => summaryOut(row, request.baseUrl)), total: rows.length, limit, offset });
}

export async function getInvoiceHandler(request: ApiRequest): Promise<ApiResult> {
  return respondWith(request.params.id!, request);
}

/**
 * Neuer Entwurf mit den Vorgaben der Oberfläche (Zahlungsziel, Format, Steuer aus den Firmendaten). Mit externer
 * Referenz idempotent: gibt es sie schon, kommt diese Rechnung unverändert mit 200 zurück statt eines Duplikats.
 */
export async function createInvoiceHandler(request: ApiRequest): Promise<ApiResult> {
  const shape = validate(draftCreateSchema, request.body);
  if ("failure" in shape) return shape.failure;
  const { externalSource, externalId, ...fields } = request.body as Record<string, unknown>;
  const input = validate(draftSchema, { ...(await newDraftDefaults(request.today)), ...fields });
  if ("failure" in input) return input.failure;
  const problem = await contactProblem(input.data.contactId);
  if (problem) return problem;
  const reference =
    shape.data.externalSource && shape.data.externalId ? { externalSource: shape.data.externalSource, externalId: shape.data.externalId } : null;
  const { invoice, created } = reference
    ? await createDraftForReference(request.actor, input.data, reference)
    : { invoice: await createDraft(request.actor, input.data), created: true };
  return respondWith(invoice.id, request, created ? 201 : 200, { Location: `/api/v1/rechnungen/${invoice.id}` });
}

/** Ändert nur die genannten Felder eines Entwurfs; lines ersetzt alle Positionen */
export async function updateInvoiceHandler(request: ApiRequest): Promise<ApiResult> {
  const shape = validate(draftPatchSchema, request.body);
  if ("failure" in shape) return shape.failure;
  const found = await getInvoice(request.params.id!);
  if (!found) return notFound(INVOICE_NOT_FOUND);
  const { invoice, lines } = found;
  if (invoice.status !== "draft") return fail("conflict", LOCKED);
  if (invoice.kind !== "rechnung" || invoice.variant || invoice.quoteId) {
    return fail("conflict", "Storno, Korrektur, Abschlags- und Schlussrechnung sowie Rechnungen zu einem Angebot bitte in Haben bearbeiten.");
  }
  const input = validate(draftSchema, { ...draftInputOf(invoice, lines), ...(request.body as object) });
  if ("failure" in input) return input.failure;
  const problem = await contactProblem(input.data.contactId);
  if (problem) return problem;
  await updateDraft(request.actor, invoice.id, input.data);
  return respondWith(invoice.id, request);
}

export async function deleteInvoiceHandler(request: ApiRequest): Promise<ApiResult> {
  const found = await getInvoice(request.params.id!);
  if (!found) return notFound(INVOICE_NOT_FOUND);
  if (found.invoice.status !== "draft") return fail("conflict", LOCKED);
  await deleteDraft(request.actor, found.invoice.id);
  return noContent();
}
