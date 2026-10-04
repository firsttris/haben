import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadCompany, sellerIssues } from "../company.ts";
import { listArticles } from "../articles.ts";
import { listContacts } from "../contacts.ts";
import { db, schema } from "../db/index.ts";
import { mailsForQuote, quotesSentByMail } from "../invoice-mail.ts";
import { authMiddleware } from "../middleware.ts";
import {
  copyQuote,
  createQuoteDraft,
  deleteQuoteDraft,
  finalizeQuote,
  getQuote,
  listQuotes,
  newQuoteDefaults,
  QuoteError,
  quoteDraftSchema,
  quoteIssues,
  quoteStatus,
  quoteToInvoice,
  setQuoteDecision,
  updateQuoteDraft,
} from "../quotes.ts";
import { today } from "../today.ts";

function asUserError(error: unknown): never {
  if (error instanceof QuoteError) throw new Error(error.message);
  throw error;
}

export const getQuotes = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const [quotes, mailed] = await Promise.all([listQuotes(today()), quotesSentByMail()]);
    return quotes.map((quote) => ({ ...quote, mailed: mailed.has(quote.id) }));
  });

async function editorContext() {
  const company = await loadCompany();
  const counters = await db.select().from(schema.quoteNumberCounters);
  return {
    contacts: await listContacts(),
    articles: (await listArticles()).map(({ id, number, description, unit, unitPrice, taxRate }) => ({ id, number, description, unit, unitPrice, taxRate })),
    company: { name: company.name, strasse: company.strasse, plz: company.plz, ort: company.ort, email: company.email, steuernummer: company.steuernummer, ustId: company.ustId, iban: company.iban, bic: company.bic, bank: company.bank },
    sellerIssues: sellerIssues(company),
    bundesland: company.bundesland,
    kleinunternehmer: company.kleinunternehmer,
    numberCounters: Object.fromEntries(counters.map((c) => [c.year, c.last])) as Record<number, number>,
  };
}

export const getNewQuote = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ draft: await newQuoteDefaults(today()), ...(await editorContext()) }));

export const getQuoteDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data }) => {
    const result = await getQuote(data);
    if (!result) throw new Error("Angebot nicht gefunden.");
    const { pdf, ...quote } = result.quote;
    const draft = quote.status === "draft";
    return {
      ...result,
      quote: { ...quote, hasPdf: pdf !== null },
      listStatus: quoteStatus(quote, today()),
      issues: draft ? await quoteIssues(data) : [],
      mails: draft ? [] : await mailsForQuote(data),
      ...(await editorContext()),
    };
  });

export const saveQuoteDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable(), draft: quoteDraftSchema }))
  .handler(async ({ data, context }) => {
    const saved = data.id
      ? await updateQuoteDraft(context.user.id, data.id, data.draft).catch(asUserError)
      : await createQuoteDraft(context.user.id, data.draft);
    return { id: saved.id };
  });

export const removeQuoteDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await deleteQuoteDraft(context.user.id, data).catch(asUserError);
    return { ok: true };
  });

export const finalizeQuoteDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const quote = await finalizeQuote(context.user.id, data).catch(asUserError);
    return { id: quote.id, number: quote.number };
  });

export const decideQuote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), decision: z.enum(["angenommen", "abgelehnt"]).nullable() }))
  .handler(async ({ data, context }) => {
    await setQuoteDecision(context.user.id, data.id, data.decision).catch(asUserError);
    return { ok: true };
  });

export const invoiceFromQuote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const invoice = await quoteToInvoice(context.user.id, data, today()).catch(asUserError);
    return { id: invoice.id };
  });

export const copyQuoteFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const quote = await copyQuote(context.user.id, data, today()).catch(asUserError);
    return { id: quote.id };
  });
