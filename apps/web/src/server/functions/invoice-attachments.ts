import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "../errors.ts";
import { authMiddleware } from "../middleware.ts";
import { MAX_DOCUMENT_SIZE } from "../modules/belege/index.ts";
import { addInvoiceAttachment, InvoiceError, MAX_INVOICE_ATTACHMENTS, removeInvoiceAttachment } from "../modules/rechnungen/index.ts";

/** Zusätzliche PDF-Anhänge an einen Rechnungsentwurf hängen (#272); jede Datei mit eigenem Ergebnis */
export const uploadInvoiceAttachments = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const invoiceId = z.uuid().safeParse(data.get("invoiceId"));
    if (!invoiceId.success) throw new UserError("Rechnung fehlt.");
    const files = data.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new UserError("Keine Datei ausgewählt.");
    if (files.length > MAX_INVOICE_ATTACHMENTS) throw new UserError(`Höchstens ${MAX_INVOICE_ATTACHMENTS} Anhänge je Rechnung.`);
    return { invoiceId: invoiceId.data, files };
  })
  .handler(async ({ data, context }) => {
    const results: { filename: string; id?: string; duplicate?: boolean; error?: string }[] = [];
    for (const file of data.files) {
      // Vor dem Einlesen prüfen, die anderen Dateien laufen trotzdem durch
      if (file.size > MAX_DOCUMENT_SIZE) {
        results.push({ filename: file.name, error: `${file.name}: größer als 20 MB.` });
        continue;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        results.push({ filename: file.name, ...(await addInvoiceAttachment(context.user.id, data.invoiceId, { bytes, filename: file.name })) });
      } catch (error) {
        if (!(error instanceof InvoiceError)) throw error;
        results.push({ filename: file.name, error: error.message });
      }
    }
    return results;
  });

export const removeInvoiceAttachmentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ invoiceId: z.uuid(), id: z.uuid() }))
  .handler(async ({ data, context }) => {
    await removeInvoiceAttachment(context.user.id, data.invoiceId, data.id);
    return { ok: true };
  });
