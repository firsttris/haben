import {
  currentFilingPeriod,
  dueDate,
  vatPeriodSchema,
  type VatPeriod,
} from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { companyIssues, loadCompany } from "../company.ts";
import { inputTaxForPeriod } from "../documents.ts";
import { computeVatFigures, preflight } from "../vat-figures.ts";
import { elsterClient, elsterMode } from "../elster.ts";
import { env } from "../env.ts";
import { authMiddleware } from "../middleware.ts";
import { openAppealDeadlines } from "../postfach.ts";
import { pendingDepreciation } from "../assets.ts";
import { today } from "../today.ts";
import {
  computedValues,
  createCorrection,
  loadActiveCertificate,
  recentSentReturns,
  returnsForPeriod,
  saveDraft,
  submissionsFor,
  submitReturn,
  VatError,
} from "../vat.ts";

// Negativ möglich, etwa wenn Gutschriften im Monat überwiegen
const centsSchema = z.number().int().min(-1_000_000_000_00).max(1_000_000_000_00);

function certificateSummary(certificate: Awaited<ReturnType<typeof loadActiveCertificate>>) {
  return certificate ? { filename: certificate.filename, validUntil: certificate.validUntil } : null;
}

export const getVatPeriod = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(vatPeriodSchema)
  .handler(async ({ data: period }) => {
    const [returns, company, certificate, recent, inputTax, figures] = await Promise.all([
      returnsForPeriod(period),
      loadCompany(),
      loadActiveCertificate(),
      recentSentReturns(),
      inputTaxForPeriod(period),
      computeVatFigures(period),
    ]);
    const submissions = await submissionsFor(returns.map((r) => r.id));
    const current = returns.find((r) => r.status === "draft") ?? returns[0] ?? null;
    return {
      period,
      dueDate: dueDate(period, company.bundesland).toISOString(),
      kleinunternehmer: company.kleinunternehmer,
      current,
      returns,
      submissions,
      recent,
      certificate: certificateSummary(certificate),
      companyIssues: companyIssues(company),
      mode: elsterMode(),
      herstellerIdConfigured: Boolean(env().ELSTER_HERSTELLER_ID) && elsterMode() === "eric",
      /** Vorsteuer aus gebuchten Belegen dieses Monats */
      inputTax,
      /** Aus den Buchungen berechnete Kennzahlen mit ihren Quellen */
      figures,
      preflight: await preflight(period, figures),
    };
  });

export const getOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const period: VatPeriod = currentFilingPeriod(new Date());
    const [returns, company, certificate, recent, computed] = await Promise.all([
      returnsForPeriod(period),
      loadCompany(),
      loadActiveCertificate(),
      recentSentReturns(3),
      computedValues(period),
    ]);
    const current = returns.find((r) => r.status === "draft") ?? returns[0] ?? null;
    return {
      period,
      /** Zahllast aus den Buchungen, solange keine Anmeldung gespeichert ist */
      computedKz83: computed.kz83,
      dueDate: dueDate(period, company.bundesland).toISOString(),
      kleinunternehmer: company.kleinunternehmer,
      afaPending: await pendingDepreciation(today()),
      appeals: (await openAppealDeadlines(today())).map((d) => ({
        id: d.id,
        datenart: d.datenart,
        veranlagungszeitraum: d.veranlagungszeitraum,
        fristende: d.frist!.fristende,
      })),
      current,
      recent,
      certificate: certificateSummary(certificate),
      companyIssues: companyIssues(company),
      companyName: company.name,
      mode: elsterMode(),
    };
  });

function asUserError(error: unknown): never {
  if (error instanceof VatError) throw new Error(error.message);
  throw error;
}

export const saveVatDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("berechnet"), period: vatPeriodSchema }),
      z.object({
        mode: z.literal("manuell"),
        period: vatPeriodSchema,
        kz81: centsSchema,
        kz86: centsSchema,
        kz21: centsSchema,
        kz45: centsSchema,
        kz48: centsSchema,
        kz66: centsSchema,
        reason: z.string().trim().min(10, "Bitte begründen, warum von den berechneten Werten abgewichen wird (mindestens 10 Zeichen).").max(1000),
      }),
    ]),
  )
  .handler(async ({ data, context }) => {
    const { period, ...input } = data;
    const saved = await saveDraft(context.user.id, period, input).catch(asUserError);
    return { id: saved.id };
  });

export const createVatCorrection = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(vatPeriodSchema)
  .handler(async ({ data, context }) => {
    const created = await createCorrection(context.user.id, data).catch(asUserError);
    return { id: created.id };
  });

export const submitVatReturn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.uuid(),
      kind: z.enum(["validate", "test", "send"]),
      pin: z.string().max(64).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await submitReturn(context.user.id, data.id, elsterClient(), {
      kind: data.kind,
      pin: data.pin,
      herstellerId: env().ELSTER_HERSTELLER_ID,
    }).catch(asUserError);
    return {
      ok: result.ok,
      code: result.code,
      message: result.message,
      transferTicket: result.transferTicket ?? null,
    };
  });
