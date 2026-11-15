import { parseDateSearch, parseEuroSearchRange, quoteStatus } from "@haben/core";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { amountIn, likePattern, numberRank, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";
import { firstHits, partsFor, runSearchParts, searchPart } from "../../db/search-parts.ts";
import { today } from "../../today.ts";
import { dunningsFor } from "./dunning.ts";
import { invoiceListFields, invoiceListQuery, withListStatus } from "./invoices.ts";
import { recurringInvoicesPart } from "./search-recurring.ts";

export type { RecurringInvoiceHit } from "./search-recurring.ts";

type Lookup = string | { id: string };

/** Rechnungen für die Befehlspalette (#617) mit Status wie in der Rechnungsliste und der letzten Mahnung */
function invoicesPart(query: Lookup, { includeDrafts }: { includeDrafts: boolean }, limit: number) {
  const invoices = schema.invoices;
  const pattern = typeof query === "string" ? likePattern(query) : "";
  const range = typeof query === "string" ? parseEuroSearchRange(query) : null;
  const queryDate = typeof query === "string" ? parseDateSearch(query) : null;
  const filter = and(
    includeDrafts ? undefined : ne(invoices.status, "draft"),
    typeof query === "string"
      ? or(
          unaccentIlike(invoices.number, pattern),
          unaccentIlike(invoices.buyerOrderReference, pattern),
          unaccentIlike(invoices.sellerOrderReference, pattern),
          unaccentIlike(sql`${invoices.buyer} ->> 'name'`, pattern),
          inArray(invoices.contactId, db.select({ id: schema.contacts.id }).from(schema.contacts).where(unaccentIlike(schema.contacts.name, pattern))),
          range !== null ? amountIn(invoices.gross, range) : undefined,
          queryDate !== null ? eq(invoices.issueDate, queryDate) : undefined,
        )
      : eq(invoices.id, query.id),
  );
  return searchPart(
    invoiceListFields,
    (fields) => invoiceListQuery(fields, filter, db, typeof query === "string" ? numberRank(invoices.number, query) : undefined).limit(limit + 1),
    async (rows) => {
      const { hits, more } = firstHits(await withListStatus(rows, today()), limit);
      const dunnings = await dunningsFor(hits.map((hit) => hit.id));
      return {
        hits: hits.map(({ id, number, customer, gross, issueDate, status, kind, listStatus, dueDate, paid, open, settledOn, cancelledBy, correctsNumber }) => {
          const dunning = dunnings.find((entry) => entry.invoiceId === id);
          return {
            id,
            number,
            customer,
            gross,
            issueDate,
            status,
            kind,
            listStatus,
            dueDate,
            paid,
            open,
            settledOn,
            cancelledBy,
            correctsNumber,
            dunning: dunning ? { level: dunning.level, dueDate: dunning.dueDate } : null,
          };
        }),
        more,
      };
    },
  );
}

export type InvoiceHit = Awaited<ReturnType<ReturnType<typeof invoicesPart>["finish"]>>["hits"][number];

/** Angebote für die Befehlspalette (#617) */
function quotesPart(query: Lookup, limit: number) {
  const quotes = schema.quotes;
  const pattern = typeof query === "string" ? likePattern(query) : "";
  const range = typeof query === "string" ? parseEuroSearchRange(query) : null;
  const queryDate = typeof query === "string" ? parseDateSearch(query) : null;
  return searchPart(
    {
      id: quotes.id,
      number: quotes.number,
      gross: quotes.gross,
      issueDate: quotes.issueDate,
      status: quotes.status,
      validUntil: quotes.validUntil,
      decision: quotes.decision,
      invoiceId: quotes.invoiceId,
      invoiceNumber: sql<string | null>`(select i.number from invoices i where i.id = ${quotes.invoiceId})`,
      contactName: schema.contacts.name,
      buyerName: sql<string | null>`${quotes.buyer} ->> 'name'`,
    },
    (fields) =>
      db
        .select(fields)
        .from(quotes)
        .leftJoin(schema.contacts, eq(schema.contacts.id, quotes.contactId))
        .where(
          typeof query === "string"
            ? or(
                unaccentIlike(quotes.number, pattern),
                unaccentIlike(sql`${quotes.buyer} ->> 'name'`, pattern),
                inArray(quotes.contactId, db.select({ id: schema.contacts.id }).from(schema.contacts).where(unaccentIlike(schema.contacts.name, pattern))),
                range !== null ? amountIn(quotes.gross, range) : undefined,
                queryDate !== null ? eq(quotes.issueDate, queryDate) : undefined,
              )
            : eq(quotes.id, query.id),
        )
        .orderBy(...(typeof query === "string" ? [numberRank(quotes.number, query)] : []), desc(quotes.issueDate), desc(quotes.createdAt))
        .limit(limit + 1),
    (rows) => {
      const date = today();
      return {
        hits: rows.slice(0, limit).map(({ id, number, gross, issueDate, buyerName, contactName, ...facts }) => ({
          id,
          number,
          gross,
          issueDate,
          customer: buyerName ?? contactName ?? "–",
          listStatus: quoteStatus(facts, date),
          validUntil: facts.validUntil,
          invoiceNumber: facts.invoiceNumber,
        })),
        more: rows.length > limit,
      };
    },
  );
}

export type QuoteHit = Awaited<ReturnType<ReturnType<typeof quotesPart>["finish"]>>["hits"][number];

/** Rechnungen, Angebote und wiederkehrende Rechnungen für die Befehlspalette in einer Abfrage; Entwürfe nur mit `includeDrafts` */
export function searchRechnungen(query: string, groups: readonly string[], options: { includeDrafts: boolean }, limit = 5) {
  return runSearchParts(
    partsFor(groups, {
      invoices: () => invoicesPart(query, options, limit),
      quotes: () => quotesPart(query, limit),
      recurringInvoices: () => recurringInvoicesPart(query, limit),
    }),
  );
}

/** Eine Rechnung für „Zuletzt angesehen“ in der Befehlspalette */
export async function searchInvoices(query: { id: string }, options: { includeDrafts: boolean }, limit = 1) {
  return (await runSearchParts({ invoices: invoicesPart(query, options, limit) })).invoices;
}

/** Ein Angebot für „Zuletzt angesehen“ in der Befehlspalette */
export async function searchQuotes(query: { id: string }, limit = 1) {
  return (await runSearchParts({ quotes: quotesPart(query, limit) })).quotes;
}
