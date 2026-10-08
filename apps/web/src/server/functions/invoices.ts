import { invoicesSentByMail, mailsForInvoice } from "../invoice-mail.ts";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { listAccounts } from "../bank.ts";
import { editorContext } from "../company.ts";
import { authMiddleware } from "../middleware.ts";
import {
  cancelInvoice,
  createCorrection,
  createDraft,
  deleteDraft,
  draftSchema,
  finalizeInvoice,
  finalizeIssues,
  getInvoice,
  invoiceSummary,
  listInvoices,
  newDraftDefaults,
  numbering,
  abschlagLinks,
  openAbschlaege,
  setNextNumber,
  updateDraft,
} from "../invoices.ts";
import { db, schema } from "../db/index.ts";
import { dunningsFor } from "../dunning.ts";
import { today } from "../today.ts";
import { UserError } from "../errors.ts";

/** Ohne PDF und XML, die gehen über die Download-Routen */
function withoutFiles<T extends { pdf: unknown; xml: unknown }>({ pdf, xml, ...rest }: T) {
  return { ...rest, hasPdf: pdf !== null, hasXml: xml !== null };
}

export const getInvoices = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const [invoices, mailed] = await Promise.all([listInvoices(today()), invoicesSentByMail()]);
    return invoices.map((invoice) => ({ ...invoice, mailed: mailed.has(invoice.id) }));
  });

export const getInvoiceSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const accounts = await listAccounts();
    return {
      ...(await invoiceSummary(today())),
      bank: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        openCount: a.openCount,
        balance: a.lastImport?.closingBalance ?? null,
        balanceDate: a.lastImport?.periodTo ?? null,
      })),
    };
  });

/** Editor-Daten samt offenen Abschlagsrechnungen für die Schlussrechnung */
async function invoiceEditorContext() {
  return {
    ...(await editorContext("rechnung")),
    abschlaege: (await openAbschlaege()).map(({ id, contactId, number, issueDate, gross, rates, taxTreatment }) => ({ id, contactId, number, issueDate, gross, rates, taxTreatment })),
  };
}

export const getNewInvoice = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ draft: await newDraftDefaults(today()), ...(await invoiceEditorContext()) }));

export const getInvoiceDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data }) => {
    const result = await getInvoice(data);
    if (!result) throw new UserError("Rechnung nicht gefunden.");
    const issues = result.invoice.status === "draft" ? await finalizeIssues(data) : [];
    // Mahnungen und ob die Rechnung gerade überfällig ist (offen und Fälligkeit vorbei)
    const listed = result.invoice.status === "final" ? (await listInvoices(today(), data))[0] : undefined;
    return {
      ...result,
      invoice: withoutFiles(result.invoice),
      issues,
      dunnings: await dunningsFor([data]),
      mails: result.invoice.status === "final" ? await mailsForInvoice(data) : [],
      overdue: listed?.listStatus === "ueberfaellig",
      fromQuote: (
        await db.select({ id: schema.quotes.id, number: schema.quotes.number }).from(schema.quotes).where(eq(schema.quotes.invoiceId, data))
      )[0] ?? null,
      open: listed?.open ?? 0,
      ...(await abschlagLinks(data)),
      ...(await invoiceEditorContext()),
    };
  });

export const saveInvoiceDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable(), draft: draftSchema }))
  .handler(async ({ data, context }) => {
    const saved = data.id
      ? await updateDraft(context.user.id, data.id, data.draft)
      : await createDraft(context.user.id, data.draft);
    return { id: saved.id };
  });

export const removeInvoiceDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await deleteDraft(context.user.id, data);
    return { ok: true };
  });

export const finalizeInvoiceDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const invoice = await finalizeInvoice(context.user.id, data);
    return { id: invoice.id, number: invoice.number };
  });

export const cancelFinalInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const storno = await cancelInvoice(context.user.id, data, today());
    return { id: storno.id, number: storno.number };
  });

export const correctFinalInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const draft = await createCorrection(context.user.id, data, today());
    return { id: draft.id };
  });

export const getNumbering = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => numbering(Number(today().slice(0, 4))));

export const saveNextNumber = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ next: z.number().int().min(1).max(99_999) }))
  .handler(async ({ data, context }) => {
    await setNextNumber(context.user.id, Number(today().slice(0, 4)), data.next);
    return { ok: true };
  });
