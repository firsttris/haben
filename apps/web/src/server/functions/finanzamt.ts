import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadCompany } from "../company.ts";
import { elsterClient, elsterMode } from "../elster.ts";
import { env } from "../env.ts";
import { FinanzamtError, listMessages, messageIssues, messageSchema, prepaymentBasis, sendMessage } from "../finanzamt.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";
import { loadActiveCertificate } from "../vat.ts";

export const getFinanzamt = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const [company, basis, messages, certificate] = await Promise.all([loadCompany(), prepaymentBasis(today()), listMessages(), loadActiveCertificate()]);
    return {
      company: { name: company.name, finanzamt: company.finanzamt, steuernummer: company.steuernummer },
      issues: messageIssues(company),
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
