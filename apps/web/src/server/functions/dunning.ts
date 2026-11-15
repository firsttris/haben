import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  createDunning,
  dunningDraft,
  dunningDraftPdf,
  dunningInputSchema,
  dunningPreview,
  dunningPreviewSchema,
  fetchBaseRate,
  overdueInvoices,
} from "../modules/rechnungen/index.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";
import { detailId } from "./schemas.ts";

export const getOverdue = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ items: await overdueInvoices(today()), today: today() }));

export const getDunningDraft = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(detailId)
  .handler(async ({ data }) => {
    const draft = await dunningDraft(data, today());
    if (!draft) throw notFound();
    return draft;
  });

export const createDunningFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(dunningInputSchema)
  .handler(async ({ data, context }) => {
    const created = await createDunning(context.user.id, data, today());
    return { id: created.id };
  });

/** Mahnung als Entwurfs-PDF aus den Eingaben, ohne sie zu speichern; die Datei kommt Base64-kodiert zurück */
export const dunningDraftPdfFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(dunningInputSchema)
  .handler(async ({ data }) => {
    const { pdf, filename } = await dunningDraftPdf(data, today());
    return { filename, base64: Buffer.from(pdf).toString("base64") };
  });

/** Blatt der Mahnung für die Vorschau aus dem Stand des Formulars */
export const renderDunningPreview = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(dunningPreviewSchema)
  .handler(({ data }) => dunningPreview(data, today()));

/** Basiszinssatz für die Einstellungen bei der Bundesbank abfragen; gespeichert wird er erst mit den Firmendaten */
export const fetchBaseRateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(() => fetchBaseRate(today()));
