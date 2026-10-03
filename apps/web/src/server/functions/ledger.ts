import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { kontenblatt, ledgerRange, saldenliste } from "../ledger.ts";
import { authMiddleware } from "../middleware.ts";
import { reportYears } from "../reports.ts";

export const ledgerPeriodSchema = z.string().regex(/^(jahr|q[1-4]|m([1-9]|1[0-2]))$/).default("jahr");
const yearSchema = z.number().int().min(2000).max(2100);

export const getSaldenliste = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema, period: ledgerPeriodSchema }))
  .handler(async ({ data }) => {
    const range = ledgerRange(data.year, data.period);
    const [rows, years] = await Promise.all([saldenliste(range), reportYears()]);
    return { ...range, rows, years };
  });

export const getKontenblatt = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ account: z.string().regex(/^\d{4,8}$/), year: yearSchema, period: ledgerPeriodSchema }))
  .handler(async ({ data }) => {
    const range = ledgerRange(data.year, data.period);
    return { ...range, ...(await kontenblatt(data.account, range)) };
  });
