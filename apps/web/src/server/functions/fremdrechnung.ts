import { createServerFn } from "@tanstack/react-start";
import { UserError } from "../errors.ts";
import { authMiddleware } from "../middleware.ts";
import { listContactChoices } from "../modules/stammdaten/index.ts";
import { adoptForeignInvoiceFile, foreignInvoiceProposal, type ForeignInvoiceInput } from "../modules/rechnungen/index.ts";

/** Wie bei Belegen: höchstens 20 MB, ein Original je Rechnung */
const MAX_SIZE = 20 * 1024 * 1024;

function fileOf(data: unknown): File {
  if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
  const file = data.get("file");
  if (!(file instanceof File)) throw new UserError("Keine Datei ausgewählt.");
  if (file.size > MAX_SIZE) throw new UserError(`${file.name}: größer als 20 MB.`);
  return file;
}

/** Vorschlag aus der Datei (E-Rechnung, falls eingebettet) und die Kunden zur Auswahl; gespeichert wird nichts */
export const readForeignInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => fileOf(data))
  .handler(async ({ data }) => {
    const bytes = new Uint8Array(await data.arrayBuffer());
    return {
      proposal: await foreignInvoiceProposal({ bytes, filename: data.name, mimeType: data.type }),
      customers: await listContactChoices("kunde"),
    };
  });

/** Legt die geprüfte Rechnung an: Datei als Original, Angaben als JSON im Feld `rechnung` */
export const adoptForeignInvoiceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    const file = fileOf(data);
    const raw = (data as FormData).get("rechnung");
    if (typeof raw !== "string") throw new UserError("Angaben zur Rechnung fehlen.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new UserError("Angaben zur Rechnung sind kein gültiges JSON.");
    }
    return { file, parsed };
  })
  .handler(async ({ data, context }) => {
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    return adoptForeignInvoiceFile(context.user.id, data.parsed as ForeignInvoiceInput, { bytes, filename: data.file.name, mimeType: data.file.type });
  });
