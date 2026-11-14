import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { listTextBlocks, listUnits, loadCompany } from "../modules/stammdaten/index.ts";
import { listContacts } from "../modules/stammdaten/index.ts";
import { authMiddleware } from "../middleware.ts";
import {
  createRecurring,
  deleteRecurring,
  getRecurring,
  invoiceForDate,
  listRecurring,
  recurringInputSchema,
  runDueRecurring,
  updateRecurring,
} from "../modules/rechnungen/index.ts";
import { today } from "../today.ts";
import { detailId } from "./schemas.ts";

async function formContext() {
  const [company, textBlocks, units] = await Promise.all([loadCompany(), listTextBlocks(), listUnits()]);
  return {
    textBlocks: textBlocks.map(({ id, name, kind, text, contactId }) => ({ id, name, kind, text, contactId })),
    /** Eigene Einheiten (#748), ohne archivierte */
    units: units.filter((unit) => !unit.archivedAt).map((unit) => unit.label),
    contacts: (await listContacts()).map((c) => ({
      id: c.id,
      name: c.name,
      ort: c.ort,
      defaultFormat: c.defaultFormat,
      leitwegId: c.leitwegId,
      nummer: c.kundennummer,
      ustId: c.ustId,
      isCustomer: c.isCustomer,
      isSupplier: c.isSupplier,
    })),
    defaults: { paymentTermDays: company.paymentTermDays, format: company.defaultFormat, kleinunternehmer: company.kleinunternehmer },
    today: today(),
  };
}

export const getRecurringList = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ items: await listRecurring(), today: today() }));

export const getRecurringForm = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => formContext());

export const getRecurringDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(detailId)
  .handler(async ({ data }) => {
    const result = await getRecurring(data);
    if (!result) throw notFound();
    // Vorschau der nächsten Rechnung mit ersetzten Platzhaltern
    return { ...result, preview: invoiceForDate(result.recurring, result.recurring.nextDate), ...(await formContext()) };
  });

export const saveRecurring = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable(), recurring: recurringInputSchema }))
  .handler(async ({ data, context }) => {
    const saved = data.id ? await updateRecurring(context.user.id, data.id, data.recurring) : await createRecurring(context.user.id, data.recurring);
    return { id: saved.id };
  });

export const removeRecurring = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await deleteRecurring(context.user.id, data);
    return { ok: true };
  });

/** Fällige Termine sofort ausführen, statt auf den stündlichen Lauf zu warten */
export const runRecurringNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(() => runDueRecurring(today()));
