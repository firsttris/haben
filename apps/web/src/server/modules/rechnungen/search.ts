import { parseDateSearch, parseEuroSearchRange, quoteStatus } from "@haben/core";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { amountIn, likePattern, numberRank, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";
import { today } from "../../today.ts";
import { dunningsFor } from "./dunning.ts";
import { selectInvoiceList } from "./invoices.ts";

type Lookup = string | { id: string };

export async function searchInvoices(query: Lookup, { includeDrafts }: { includeDrafts: boolean }, limit = 5) {
  const invoices = schema.invoices;
  const pattern = typeof query === "string" ? likePattern(query) : "";
  const range = typeof query === "string" ? parseEuroSearchRange(query) : null;
  const queryDate = typeof query === "string" ? parseDateSearch(query) : null;
  const rows = await selectInvoiceList(
    today(),
    and(
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
    ),
    db,
    limit + 1,
    typeof query === "string" ? numberRank(invoices.number, query) : undefined,
  );
  const hits = rows.slice(0, limit);
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
    more: rows.length > limit,
  };
}

export type InvoiceHit = Awaited<ReturnType<typeof searchInvoices>>["hits"][number];

export async function searchQuotes(query: Lookup, limit = 5) {
  const quotes = schema.quotes;
  const pattern = typeof query === "string" ? likePattern(query) : "";
  const range = typeof query === "string" ? parseEuroSearchRange(query) : null;
  const queryDate = typeof query === "string" ? parseDateSearch(query) : null;
  const rows = await db
    .select({
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
    })
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
    .limit(limit + 1);
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
}

export type QuoteHit = Awaited<ReturnType<typeof searchQuotes>>["hits"][number];
