import { parseBmfRates } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "../errors.ts";
import { applyPublishedRates } from "../modules/belege/index.ts";
import {
  companyIssues,
  companySchema,
  deleteExchangeRate,
  ExchangeRateFetchError,
  exchangeRateSchema,
  listExchangeRates,
  loadCompany,
  refreshExchangeRates,
  storeExchangeRates,
} from "../modules/stammdaten/index.ts";
import { authMiddleware } from "../middleware.ts";
import { saveCompany as saveCompanySettings, settingsLocks } from "../modules/stammdaten/index.ts";
import { saveTaxpayer, taxpayerSchema } from "../modules/stammdaten/index.ts";
import { today } from "../today.ts";

export const getCompany = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const company = await loadCompany();
    return { company, issues: companyIssues(company), locks: await settingsLocks(today()) };
  });

export const saveCompany = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(companySchema)
  .handler(async ({ data, context }) => {
    await saveCompanySettings(context.user.id, data, today());
    return { ok: true };
  });

export const saveTaxpayerData = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(taxpayerSchema)
  .handler(async ({ data, context }) => {
    await saveTaxpayer(context.user.id, data);
    return { ok: true };
  });

export const getExchangeRates = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ rates: await listExchangeRates() }));

export const saveExchangeRateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(exchangeRateSchema)
  .handler(async ({ data, context }) => {
    await storeExchangeRates(context.user.id, [data], "manuell");
    return { applied: await applyPublishedRates(context.user.id) };
  });

export const deleteExchangeRateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ currency: z.string(), month: z.string() }))
  .handler(async ({ data, context }) => {
    await deleteExchangeRate(context.user.id, data.currency, data.month);
    return { ok: true };
  });

/** Kurse jetzt beim BMF abrufen; Belege ohne Kurs bekommen danach den Kurs ihres Monats */
export const refreshExchangeRatesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const result = await refreshExchangeRates(context.user.id, today());
      return { ...result, applied: await applyPublishedRates(context.user.id) };
    } catch (error) {
      if (error instanceof ExchangeRateFetchError) throw new UserError(error.message);
      throw error;
    }
  });

/** CSV-Datei des BMF von Hand hochladen, falls der Abruf nicht geht (z. B. ohne Internetzugang des Servers) */
export const importExchangeRatesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ year: z.number().int().min(2010).max(2100), text: z.string().max(2_000_000) }))
  .handler(async ({ data, context }) => {
    const rates = parseBmfRates(data.text, data.year);
    if (rates.length === 0) throw new UserError(`In der Datei stehen keine Kurse für ${data.year}. Erwartet wird die CSV-Datei des BMF mit einer Spalte je Monat.`);
    const result = await storeExchangeRates(context.user.id, rates, "bmf");
    return { ...result, fetched: rates.length, applied: await applyPublishedRates(context.user.id) };
  });
