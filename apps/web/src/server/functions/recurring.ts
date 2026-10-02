import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadCompany } from "../company.ts";
import { listContacts } from "../contacts.ts";
import { authMiddleware } from "../middleware.ts";
import {
  createRecurring,
  deleteRecurring,
  getRecurring,
  invoiceForDate,
  listRecurring,
  recurringInputSchema,
  RecurringError,
  runDueRecurring,
  updateRecurring,
} from "../recurring.ts";
import { today } from "../today.ts";

function asUserError(error: unknown): never {
  if (error instanceof RecurringError) throw new Error(error.message);
  throw error;
}

async function formContext() {
  const company = await loadCompany();
  return {
    contacts: (await listContacts()).map((c) => ({ id: c.id, name: c.name, ort: c.ort, defaultFormat: c.defaultFormat, leitwegId: c.leitwegId })),
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
  .validator(z.uuid())
  .handler(async ({ data }) => {
    const result = await getRecurring(data);
    if (!result) throw new Error("Vorlage nicht gefunden.");
    // Vorschau der nächsten Rechnung mit ersetzten Platzhaltern
    return { ...result, preview: invoiceForDate(result.recurring, result.recurring.nextDate), ...(await formContext()) };
  });

export const saveRecurring = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable(), recurring: recurringInputSchema }))
  .handler(async ({ data, context }) => {
    const saved = data.id
      ? await updateRecurring(context.user.id, data.id, data.recurring).catch(asUserError)
      : await createRecurring(context.user.id, data.recurring).catch(asUserError);
    return { id: saved.id };
  });

export const removeRecurring = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await deleteRecurring(context.user.id, data).catch(asUserError);
    return { ok: true };
  });

/** Fällige Termine sofort ausführen, statt auf den stündlichen Lauf zu warten */
export const runRecurringNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(() => runDueRecurring(today()));
