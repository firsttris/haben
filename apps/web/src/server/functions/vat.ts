import {
  currentFilingPeriod,
  dueDate,
  vatPeriodSchema,
  type VatPeriod,
} from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { companyIssues, loadCompany } from "../company.ts";
import { elsterClient, elsterMode } from "../elster.ts";
import { env } from "../env.ts";
import { authMiddleware } from "../middleware.ts";
import {
  createCorrection,
  loadActiveCertificate,
  recentSentReturns,
  returnsForPeriod,
  saveDraft,
  submissionsFor,
  submitReturn,
  VatError,
} from "../vat.ts";

const centsSchema = z.number().int().min(0).max(1_000_000_000_00);

function certificateSummary(certificate: Awaited<ReturnType<typeof loadActiveCertificate>>) {
  return certificate ? { filename: certificate.filename, validUntil: certificate.validUntil } : null;
}

export const getVatPeriod = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(vatPeriodSchema)
  .handler(async ({ data: period }) => {
    const [returns, company, certificate, recent] = await Promise.all([
      returnsForPeriod(period),
      loadCompany(),
      loadActiveCertificate(),
      recentSentReturns(),
    ]);
    const submissions = await submissionsFor(returns.map((r) => r.id));
    const current = returns.find((r) => r.status === "draft") ?? returns[0] ?? null;
    return {
      period,
      dueDate: dueDate(period).toISOString(),
      current,
      returns,
      submissions,
      recent,
      certificate: certificateSummary(certificate),
      companyIssues: companyIssues(company),
      mode: elsterMode(),
      herstellerIdConfigured: Boolean(env().ELSTER_HERSTELLER_ID),
    };
  });

export const getOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const period: VatPeriod = currentFilingPeriod(new Date());
    const [returns, company, certificate, recent] = await Promise.all([
      returnsForPeriod(period),
      loadCompany(),
      loadActiveCertificate(),
      recentSentReturns(3),
    ]);
    const current = returns.find((r) => r.status === "draft") ?? returns[0] ?? null;
    return {
      period,
      dueDate: dueDate(period).toISOString(),
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
    z.object({ period: vatPeriodSchema, kz81: centsSchema, kz86: centsSchema, kz66: centsSchema }),
  )
  .handler(async ({ data, context }) => {
    const saved = await saveDraft(context.user.id, data.period, data).catch(asUserError);
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
