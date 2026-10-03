import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadCompany } from "../company.ts";
import { elsterClient, elsterMode } from "../elster.ts";
import { env } from "../env.ts";
import {
  bankChangeIssues,
  bankChangeSchema,
  FinanzamtError,
  listMessages,
  messageIssues,
  messageSchema,
  prepaymentBasis,
  sendBankChange,
  sendMessage,
} from "../finanzamt.ts";
import { authMiddleware } from "../middleware.ts";
import { fetchPostfach, lastPostfachRequest, listPostfachDocuments, pendingConfirmations } from "../postfach.ts";
import { today } from "../today.ts";
import { loadActiveCertificate } from "../vat.ts";

export const getFinanzamt = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const [company, basis, messages, certificate, documents, lastFetch, pendingTest, pendingLive] = await Promise.all([
      loadCompany(),
      prepaymentBasis(today()),
      listMessages(),
      loadActiveCertificate(),
      listPostfachDocuments(),
      lastPostfachRequest(),
      pendingConfirmations(true),
      pendingConfirmations(false),
    ]);
    return {
      company: { name: company.name, finanzamt: company.finanzamt, steuernummer: company.steuernummer, iban: company.iban },
      person: company.taxpayer.a ? { vorname: company.taxpayer.a.vorname, name: company.taxpayer.a.name } : null,
      issues: messageIssues(company),
      bankIssues: bankChangeIssues(company),
      documents,
      lastFetch,
      pendingConfirmations: { test: pendingTest.length, live: pendingLive.length },
      basis,
      messages,
      certificate: certificate ? { filename: certificate.filename } : null,
      mode: elsterMode(),
      herstellerIdConfigured: Boolean(env().ELSTER_HERSTELLER_ID) && elsterMode() === "eric",
    };
  });

export const sendFinanzamtMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(messageSchema.extend({ kind: z.enum(["validate", "test", "send"]), pin: z.string().max(64).optional() }))
  .handler(async ({ data, context }) => {
    const { kind, pin, ...message } = data;
    try {
      const result = await sendMessage(context.user.id, message, elsterClient(), { kind, pin, herstellerId: env().ELSTER_HERSTELLER_ID });
      return { ok: result.ok, code: result.code, message: result.message, transferTicket: result.transferTicket ?? null };
    } catch (error) {
      if (error instanceof FinanzamtError) throw new Error(error.message, { cause: error });
      throw error;
    }
  });

const rethrow = (error: unknown): never => {
  if (error instanceof FinanzamtError) throw new Error(error.message, { cause: error });
  throw error;
};

export const sendFinanzamtBankChange = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(bankChangeSchema.extend({ kind: z.enum(["validate", "test", "send"]), pin: z.string().max(64).optional() }))
  .handler(async ({ data, context }) => {
    const { kind, pin, ...input } = data;
    try {
      const result = await sendBankChange(context.user.id, input, elsterClient(), { kind, pin, herstellerId: env().ELSTER_HERSTELLER_ID });
      return { ok: result.ok, code: result.code, message: result.message, transferTicket: result.transferTicket ?? null };
    } catch (error) {
      return rethrow(error);
    }
  });

export const fetchFinanzamtPostfach = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ kind: z.enum(["test", "send"]), pin: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    try {
      return await fetchPostfach(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID });
    } catch (error) {
      return rethrow(error);
    }
  });
