import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { listAccounts } from "../bank.ts";
import { loadCompany, sellerIssues } from "../company.ts";
import { listContacts } from "../contacts.ts";
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
  InvoiceError,
  invoiceSummary,
  listInvoices,
  newDraftDefaults,
  numbering,
  setNextNumber,
  updateDraft,
} from "../invoices.ts";
import { db, schema } from "../db/index.ts";
import { today } from "../today.ts";

function asUserError(error: unknown): never {
  if (error instanceof InvoiceError) throw new Error(error.message);
  throw error;
}

/** Ohne PDF und XML, die gehen über die Download-Routen */
function withoutFiles<T extends { pdf: unknown; xml: unknown }>({ pdf, xml, ...rest }: T) {
  return { ...rest, hasPdf: pdf !== null, hasXml: xml !== null };
}

export const getInvoices = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => listInvoices(today()));

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

async function editorContext() {
  const company = await loadCompany();
  // Je Jahr die letzte Nummer; der Editor zeigt die Nummer zum Jahr des Rechnungsdatums
  const counters = await db.select().from(schema.invoiceNumberCounters);
  return {
    contacts: await listContacts(),
    company: { name: company.name, strasse: company.strasse, plz: company.plz, ort: company.ort, email: company.email, steuernummer: company.steuernummer, ustId: company.ustId, iban: company.iban, bic: company.bic, bank: company.bank },
    sellerIssues: sellerIssues(company),
    numberCounters: Object.fromEntries(counters.map((c) => [c.year, c.last])) as Record<number, number>,
  };
}

export const getNewInvoice = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ draft: await newDraftDefaults(today()), ...(await editorContext()) }));

export const getInvoiceDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data }) => {
    const result = await getInvoice(data);
    if (!result) throw new Error("Rechnung nicht gefunden.");
    const issues = result.invoice.status === "draft" ? await finalizeIssues(data) : [];
    return { ...result, invoice: withoutFiles(result.invoice), issues, ...(await editorContext()) };
  });

export const saveInvoiceDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable(), draft: draftSchema }))
  .handler(async ({ data, context }) => {
    const saved = data.id
      ? await updateDraft(context.user.id, data.id, data.draft).catch(asUserError)
      : await createDraft(context.user.id, data.draft);
    return { id: saved.id };
  });

export const removeInvoiceDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await deleteDraft(context.user.id, data).catch(asUserError);
    return { ok: true };
  });

export const finalizeInvoiceDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const invoice = await finalizeInvoice(context.user.id, data).catch(asUserError);
    return { id: invoice.id, number: invoice.number };
  });

export const cancelFinalInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const storno = await cancelInvoice(context.user.id, data, today()).catch(asUserError);
    return { id: storno.id, number: storno.number };
  });

export const correctFinalInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const draft = await createCorrection(context.user.id, data, today()).catch(asUserError);
    return { id: draft.id };
  });

export const getNumbering = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => numbering(Number(today().slice(0, 4))));

export const saveNextNumber = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ next: z.number().int().min(1).max(99_999) }))
  .handler(async ({ data, context }) => {
    await setNextNumber(context.user.id, Number(today().slice(0, 4)), data.next).catch(asUserError);
    return { ok: true };
  });
