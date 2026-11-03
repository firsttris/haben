import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { kontenblatt, ledgerPeriodSchema, ledgerRange, saldenliste } from "../modules/buchhaltung/index.ts";
import { authMiddleware } from "../middleware.ts";
import { reportYears } from "../modules/auswertungen/index.ts";
import { loadCompany } from "../modules/stammdaten/index.ts";
import { isKapitalgesellschaft } from "@haben/core";
import { yearSchema } from "./schemas.ts";

export const getSaldenliste = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema, period: ledgerPeriodSchema }))
  .handler(async ({ data }) => {
    const range = ledgerRange(data.year, data.period);
    const [rows, years, company] = await Promise.all([saldenliste(range), reportYears(), loadCompany()]);
    // GmbH und UG bilanzieren: Bestandskonten tragen ihren Saldo aus den Vorjahren vor (saldenliste)
    return { ...range, rows, years, vortrag: isKapitalgesellschaft(company.rechtsform) };
  });

export const getKontenblatt = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ account: z.string().regex(/^\d{4,8}$/), year: yearSchema, period: ledgerPeriodSchema }))
  .handler(async ({ data }) => {
    const range = ledgerRange(data.year, data.period);
    return { ...range, ...(await kontenblatt(data.account, range)) };
  });
