import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  dunningMailDraft,
  invoiceMailDraft,
  invoiceMailSchema,
  outgoingMailSchema,
  quoteMailDraft,
  sendDunningMail,
  sendInvoiceMail,
  sendQuoteMail,
} from "../modules/rechnungen/index.ts";
import { authMiddleware } from "../middleware.ts";

const target = z.object({ kind: z.enum(["rechnung", "mahnung", "angebot"]), id: z.uuid() });

/** Nur die Rechnung kennt Zusatzanhänge zur Auswahl */
const outgoing = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rechnung"), id: z.uuid(), mail: invoiceMailSchema }),
  z.object({ kind: z.literal("mahnung"), id: z.uuid(), mail: outgoingMailSchema }),
  z.object({ kind: z.literal("angebot"), id: z.uuid(), mail: outgoingMailSchema }),
]);

/** Vorschlag für Empfänger, Betreff und Text samt Anhängen */
export const getMailDraft = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(target)
  .handler(({ data }) =>
    data.kind === "rechnung" ? invoiceMailDraft(data.id) : data.kind === "angebot" ? quoteMailDraft(data.id) : dunningMailDraft(data.id),
  );

export const sendDocumentMail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(outgoing)
  .handler(({ data, context }) =>
    data.kind === "rechnung"
      ? sendInvoiceMail(context.user.id, data.id, data.mail)
      : data.kind === "angebot"
        ? sendQuoteMail(context.user.id, data.id, data.mail)
        : sendDunningMail(context.user.id, data.id, data.mail),
  );
