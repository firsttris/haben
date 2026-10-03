import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  dunningMailDraft,
  invoiceMailDraft,
  mailsForInvoice,
  outgoingMailSchema,
  quoteMailDraft,
  sendDunningMail,
  sendInvoiceMail,
  sendQuoteMail,
} from "../invoice-mail.ts";
import { MailError } from "../mail.ts";
import { authMiddleware } from "../middleware.ts";

const rethrow = (error: unknown): never => {
  if (error instanceof MailError) throw new Error(error.message, { cause: error });
  throw error;
};

const target = z.object({ kind: z.enum(["rechnung", "mahnung", "angebot"]), id: z.uuid() });

/** Vorschlag für Empfänger, Betreff und Text samt Anhängen */
export const getMailDraft = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(target)
  .handler(({ data }) =>
    (data.kind === "rechnung" ? invoiceMailDraft(data.id) : data.kind === "angebot" ? quoteMailDraft(data.id) : dunningMailDraft(data.id)).catch(rethrow),
  );

export const sendDocumentMail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(target.extend({ mail: outgoingMailSchema }))
  .handler(({ data, context }) =>
    (data.kind === "rechnung"
      ? sendInvoiceMail(context.user.id, data.id, data.mail)
      : data.kind === "angebot"
        ? sendQuoteMail(context.user.id, data.id, data.mail)
        : sendDunningMail(context.user.id, data.id, data.mail)
    ).catch(rethrow),
  );

export const getInvoiceMails = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(({ data }) => mailsForInvoice(data));
