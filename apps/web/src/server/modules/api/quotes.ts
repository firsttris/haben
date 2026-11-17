import type { z } from "zod";
import { getQuote, listQuotes } from "../rechnungen/index.ts";
import { notFound, ok, validate, type ApiRequest, type ApiResult } from "./http.ts";
import { quoteQuerySchema, type quoteSchema, type quoteSummarySchema } from "./quotes-schemas.ts";

/*
 * Angebote über die REST-API (#297): nur lesen. Festschreiben, Versenden, die Antwort des Kunden und die Rechnung aus
 * dem Angebot bleiben ein Klick in Haben, auf den `url` in jeder Antwort zeigt.
 */

type ListRow = Awaited<ReturnType<typeof listQuotes>>[number];
type Detail = NonNullable<Awaited<ReturnType<typeof getQuote>>>;

const QUOTE_NOT_FOUND = "Angebot nicht gefunden.";

function summaryOut(row: ListRow, baseUrl: string): z.output<typeof quoteSummarySchema> {
  return {
    id: row.id,
    status: row.status,
    listStatus: row.listStatus,
    number: row.number,
    contactId: row.contactId,
    customer: row.customer,
    issueDate: row.issueDate,
    validUntil: row.validUntil,
    net: row.net,
    gross: row.gross,
    decision: row.decision,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber,
    url: `${baseUrl}/angebote/${row.id}`,
  };
}

function quoteOut(row: ListRow, { quote, lines, choices }: Detail, baseUrl: string): z.output<typeof quoteSchema> {
  return {
    ...summaryOut(row, baseUrl),
    serviceFrom: quote.serviceFrom,
    serviceTo: quote.serviceTo,
    intro: quote.intro,
    note: quote.note,
    buyerOrderReference: quote.buyerOrderReference,
    sellerOrderReference: quote.sellerOrderReference,
    despatchAdviceReference: quote.despatchAdviceReference,
    language: quote.language,
    taxTreatment: quote.taxTreatment,
    exemptionReason: quote.exemptionReason,
    taxDetails: quote.taxDetails,
    priceMode: quote.priceMode,
    tax: quote.tax,
    decidedAt: quote.decidedAt?.toISOString() ?? null,
    lines: lines.map(({ position, description, detail, itemNumber, quantity, unit, unitPrice, taxRate, net, kind }) => ({
      position,
      description,
      detail,
      itemNumber,
      quantity,
      unit,
      unitPrice,
      taxRate,
      net,
      kind,
    })),
    choices,
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
    lockedAt: quote.lockedAt?.toISOString() ?? null,
  };
}

export async function listQuotesHandler(request: ApiRequest): Promise<ApiResult> {
  const query = validate(quoteQuerySchema, request.query);
  if ("failure" in query) return query.failure;
  const { status, number, limit, offset } = query.data;
  // Zod nimmt die UUID auch in Großbuchstaben an, Postgres liefert sie klein; Pfad-IDs schreibt der Router ebenso klein
  const contactId = query.data.contactId?.toLowerCase();
  const rows = (await listQuotes(request.today)).filter(
    (row) => (!status || row.status === status) && (!contactId || row.contactId === contactId) && (!number || row.number === number),
  );
  return ok({ data: rows.slice(offset, offset + limit).map((row) => summaryOut(row, request.baseUrl)), total: rows.length, limit, offset });
}

export async function getQuoteHandler(request: ApiRequest): Promise<ApiResult> {
  const id = request.params.id!;
  const [detail, [row]] = await Promise.all([getQuote(id), listQuotes(request.today, id)]);
  if (!detail || !row) return notFound(QUOTE_NOT_FOUND);
  return ok(quoteOut(row, detail, request.baseUrl));
}
