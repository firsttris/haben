import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { editorContext } from "../company.ts";
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
  quoteDraftSchema,
  quoteIssues,
  quoteStatus,
  quoteToInvoice,
  setQuoteDecision,
  updateQuoteDraft,
} from "../quotes.ts";
import { today } from "../today.ts";
import { UserError } from "../errors.ts";

export const getQuotes = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const [quotes, mailed] = await Promise.all([listQuotes(today()), quotesSentByMail()]);
    return quotes.map((quote) => ({ ...quote, mailed: mailed.has(quote.id) }));
  });

export const getNewQuote = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ draft: await newQuoteDefaults(today()), ...(await editorContext("angebot")) }));

export const getQuoteDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data }) => {
    const result = await getQuote(data);
    if (!result) throw new UserError("Angebot nicht gefunden.");
    const { pdf, ...quote } = result.quote;
    const draft = quote.status === "draft";
    return {
      ...result,
      quote: { ...quote, hasPdf: pdf !== null },
      listStatus: quoteStatus(quote, today()),
      issues: draft ? await quoteIssues(data) : [],
      mails: draft ? [] : await mailsForQuote(data),
      ...(await editorContext("angebot")),
    };
  });

export const saveQuoteDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable(), draft: quoteDraftSchema }))
  .handler(async ({ data, context }) => {
    const saved = data.id
      ? await updateQuoteDraft(context.user.id, data.id, data.draft)
      : await createQuoteDraft(context.user.id, data.draft);
    return { id: saved.id };
  });

export const removeQuoteDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await deleteQuoteDraft(context.user.id, data);
    return { ok: true };
  });

export const finalizeQuoteDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const quote = await finalizeQuote(context.user.id, data);
    return { id: quote.id, number: quote.number };
  });

export const decideQuote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), decision: z.enum(["angenommen", "abgelehnt"]).nullable() }))
  .handler(async ({ data, context }) => {
    await setQuoteDecision(context.user.id, data.id, data.decision);
    return { ok: true };
  });

export const invoiceFromQuote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const invoice = await quoteToInvoice(context.user.id, data, today());
    return { id: invoice.id };
  });

export const copyQuoteFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const quote = await copyQuote(context.user.id, data, today());
    return { id: quote.id };
  });
