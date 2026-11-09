import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  cashBook,
  cashInputSchema,
  cashInvoiceCandidates,
  cashInvoiceInputSchema,
  createCashEntry,
  createCashInvoiceEntry,
  cashIncomeInputSchema,
  createCashIncome,
  reverseCashEntry,
} from "../modules/bank/index.ts";
import { kleinunternehmerStand } from "../modules/stammdaten/index.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";
import { yearSchema } from "./schemas.ts";

export const getCashBook = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(yearSchema)
  .handler(async ({ data: year }) => ({
    ...(await cashBook(year)),
    openInvoices: await cashInvoiceCandidates(),
    today: today(),
    /** Steuer einer Bareinnahme ohne Rechnung: Das Formular bietet an, was der Server für den Monat der Bareinnahme annimmt */
    kleinunternehmer: await kleinunternehmerStand(),
  }));

export const createCashEntryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(cashInputSchema)
  .handler(async ({ data, context }) => {
    const row = await createCashEntry(context.user.id, data, today());
    return { number: row.number };
  });

/** Bareinnahme auf eine offene Ausgangsrechnung */
export const createCashInvoiceEntryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(cashInvoiceInputSchema)
  .handler(async ({ data, context }) => {
    const row = await createCashInvoiceEntry(context.user.id, data, today());
    return { number: row.number };
  });

/** Bareinnahme ohne Rechnung, etwa die Tagessumme eines Marktstands (#276) */
export const createCashIncomeFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(cashIncomeInputSchema)
  .handler(async ({ data, context }) => {
    const row = await createCashIncome(context.user.id, data, today());
    return { number: row.number };
  });

export const reverseCashEntryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const row = await reverseCashEntry(context.user.id, data, today());
    return { number: row.number };
  });
