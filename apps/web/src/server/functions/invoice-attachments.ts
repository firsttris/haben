import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "../errors.ts";
import { authMiddleware } from "../middleware.ts";
import { MAX_DOCUMENT_SIZE } from "../modules/belege/index.ts";
import {
  addInvoiceAttachment,
  addQuoteAttachment,
  addQuoteDefaultAttachment,
  listQuoteDefaultAttachments,
  InvoiceError,
  MAX_INVOICE_ATTACHMENTS,
  QuoteError,
  removeInvoiceAttachment,
  removeQuoteAttachment,
  removeQuoteDefaultAttachment,
} from "../modules/rechnungen/index.ts";

/** Zusätzliche Anhänge an Rechnung (#272) oder Angebot (#415), dazu die Standardanhänge für Angebote in den Einstellungen */
const attachmentKind = z.enum(["rechnung", "angebot", "standard"]);
export type AttachmentKind = z.infer<typeof attachmentKind>;

type UploadedFile = { bytes: Uint8Array; filename: string };
type Actions = {
  add: (actor: string, ownerId: string, file: UploadedFile) => Promise<{ id: string; duplicate: boolean }>;
  remove: (actor: string, ownerId: string, id: string) => Promise<void>;
  /** Ohne Beleg: die Standardanhänge hängen an keinem */
  owned: boolean;
  noun: string;
  perOwner: string;
};

const ACTIONS: Record<AttachmentKind, Actions> = {
  rechnung: { add: addInvoiceAttachment, remove: removeInvoiceAttachment, owned: true, noun: "Rechnung", perOwner: "je Rechnung" },
  angebot: { add: addQuoteAttachment, remove: removeQuoteAttachment, owned: true, noun: "Angebot", perOwner: "je Angebot" },
  standard: {
    add: (actor, _ownerId, file) => addQuoteDefaultAttachment(actor, file),
    remove: (actor, _ownerId, id) => removeQuoteDefaultAttachment(actor, id),
    owned: false,
    noun: "Einstellung",
    perOwner: "als Standardanhänge",
  },
};

/** Ohne Beleg steht hier keine ID; die Aktionen der Standardanhänge lesen sie nicht */
const NO_OWNER = "";

/** Zusätzliche PDF-Anhänge an einen Entwurf hängen; jede Datei mit eigenem Ergebnis */
export const uploadInvoiceAttachments = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const kind = attachmentKind.safeParse(data.get("kind"));
    if (!kind.success) throw new UserError("Unbekannte Belegart.");
    const actions = ACTIONS[kind.data];
    const ownerId = actions.owned ? z.uuid().safeParse(data.get("ownerId")) : { success: true as const, data: NO_OWNER };
    if (!ownerId.success) throw new UserError(`${actions.noun} fehlt.`);
    const files = data.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new UserError("Keine Datei ausgewählt.");
    if (files.length > MAX_INVOICE_ATTACHMENTS) throw new UserError(`Höchstens ${MAX_INVOICE_ATTACHMENTS} Anhänge ${actions.perOwner}.`);
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
  .validator(
    z
      .object({ kind: attachmentKind, ownerId: z.uuid().optional(), id: z.uuid() })
      .refine((d) => !ACTIONS[d.kind].owned || d.ownerId, { message: "Beleg fehlt." }),
  )
  .handler(async ({ data, context }) => {
    await ACTIONS[data.kind].remove(context.user.id, data.ownerId ?? NO_OWNER, data.id);
    return { ok: true };
  });

/** Standardanhänge für Angebote, für die Einstellungen */
export const getQuoteDefaultAttachments = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => (await listQuoteDefaultAttachments()).map(({ id, filename, size }) => ({ id, filename, size })));
