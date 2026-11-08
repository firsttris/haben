import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "../errors.ts";
import { authMiddleware } from "../middleware.ts";
import { MAX_DOCUMENT_SIZE } from "../modules/belege/index.ts";
import {
  addInvoiceAttachment,
  addQuoteAttachment,
  InvoiceError,
  MAX_INVOICE_ATTACHMENTS,
  QuoteError,
  removeInvoiceAttachment,
  removeQuoteAttachment,
} from "../modules/rechnungen/index.ts";

/** Zusätzliche Anhänge an Rechnung (#272) oder Angebot (#415) */
const attachmentKind = z.enum(["rechnung", "angebot"]);
export type AttachmentKind = z.infer<typeof attachmentKind>;

const ACTIONS = {
  rechnung: { add: addInvoiceAttachment, remove: removeInvoiceAttachment, noun: "Rechnung", perOwner: "je Rechnung" },
  angebot: { add: addQuoteAttachment, remove: removeQuoteAttachment, noun: "Angebot", perOwner: "je Angebot" },
} as const;

/** Zusätzliche PDF-Anhänge an einen Entwurf hängen; jede Datei mit eigenem Ergebnis */
export const uploadInvoiceAttachments = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const kind = attachmentKind.safeParse(data.get("kind"));
    if (!kind.success) throw new UserError("Unbekannte Belegart.");
    const ownerId = z.uuid().safeParse(data.get("ownerId"));
    if (!ownerId.success) throw new UserError(`${ACTIONS[kind.data].noun} fehlt.`);
    const files = data.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new UserError("Keine Datei ausgewählt.");
    if (files.length > MAX_INVOICE_ATTACHMENTS) throw new UserError(`Höchstens ${MAX_INVOICE_ATTACHMENTS} Anhänge ${ACTIONS[kind.data].perOwner}.`);
    return { kind: kind.data, ownerId: ownerId.data, files };
  })
  .handler(async ({ data, context }) => {
    const { add } = ACTIONS[data.kind];
    const results: { filename: string; id?: string; duplicate?: boolean; error?: string }[] = [];
    for (const file of data.files) {
      // Vor dem Einlesen prüfen, die anderen Dateien laufen trotzdem durch
      if (file.size > MAX_DOCUMENT_SIZE) {
        results.push({ filename: file.name, error: `${file.name}: größer als 20 MB.` });
        continue;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        results.push({ filename: file.name, ...(await add(context.user.id, data.ownerId, { bytes, filename: file.name })) });
      } catch (error) {
        if (!(error instanceof InvoiceError || error instanceof QuoteError)) throw error;
        results.push({ filename: file.name, error: error.message });
      }
    }
    return results;
  });

export const removeInvoiceAttachmentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ kind: attachmentKind, ownerId: z.uuid(), id: z.uuid() }))
  .handler(async ({ data, context }) => {
    await ACTIONS[data.kind].remove(context.user.id, data.ownerId, data.id);
    return { ok: true };
  });
