import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { likePattern } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";

export interface InvoiceHit {
  id: string;
  number: string | null;
  customer: string;
  gross: number;
  status: string;
  kind: string;
}

/** Rechnungssuche für die Befehlspalette (#617): Nummer und Kundenname; Entwürfe nur mit includeDrafts */
export async function searchInvoices(query: string, opts: { includeDrafts: boolean }, limit = 5): Promise<{ hits: InvoiceHit[]; more: boolean }> {
  const pattern = likePattern(query);
  const rows = await db
    .select({
      id: schema.invoices.id,
      number: schema.invoices.number,
      gross: schema.invoices.gross,
      status: schema.invoices.status,
      kind: schema.invoices.kind,
      contactName: schema.contacts.name,
      buyerName: sql<string | null>`${schema.invoices.buyer} ->> 'name'`,
    })
    .from(schema.invoices)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
    .where(
      and(
        opts.includeDrafts ? undefined : ne(schema.invoices.status, "draft"),
        or(
          ilike(schema.invoices.number, pattern),
          ilike(schema.contacts.name, pattern),
          sql<boolean>`coalesce(${schema.invoices.buyer} ->> 'name', '') ilike ${pattern}`,
        ),
      ),
    )
    .orderBy(desc(schema.invoices.issueDate), sql`${schema.invoices.number} desc nulls first`, desc(schema.invoices.createdAt))
    .limit(limit + 1);
  return {
    hits: rows.slice(0, limit).map((row) => ({
      id: row.id,
      number: row.number,
      customer: row.buyerName ?? row.contactName ?? "–",
      gross: row.gross,
      status: row.status,
      kind: row.kind,
    })),
    more: rows.length > limit,
  };
}

export interface QuoteHit {
  id: string;
  number: string | null;
  customer: string;
  gross: number;
  status: string;
}

/** Angebotssuche für die Befehlspalette (#617): Nummer und Kundenname */
export async function searchQuotes(query: string, limit = 5): Promise<{ hits: QuoteHit[]; more: boolean }> {
  const pattern = likePattern(query);
  const rows = await db
    .select({
      id: schema.quotes.id,
      number: schema.quotes.number,
      gross: schema.quotes.gross,
      status: schema.quotes.status,
      contactName: schema.contacts.name,
      buyerName: sql<string | null>`${schema.quotes.buyer} ->> 'name'`,
    })
    .from(schema.quotes)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.quotes.contactId))
    .where(
      or(
        ilike(schema.quotes.number, pattern),
        ilike(schema.contacts.name, pattern),
        sql<boolean>`coalesce(${schema.quotes.buyer} ->> 'name', '') ilike ${pattern}`,
      ),
    )
    .orderBy(sql`${schema.quotes.number} desc nulls first`, desc(schema.quotes.createdAt))
    .limit(limit + 1);
  return {
    hits: rows.slice(0, limit).map((row) => ({
      id: row.id,
      number: row.number,
      customer: row.buyerName ?? row.contactName ?? "–",
      gross: row.gross,
      status: row.status,
    })),
    more: rows.length > limit,
  };
}
