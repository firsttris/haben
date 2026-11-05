import { MAX_IMPORT_BYTES } from "@haben/import";
import { createServerFn } from "@tanstack/react-start";
import { csvImportOptionsSchema, previewCsvImport, runCsvImport } from "../modules/datenimport/index.ts";
import { authMiddleware } from "../middleware.ts";
import { UserError } from "../errors.ts";

/** FormData mit der Datei („file“) und den Einstellungen als JSON („options“), für Vorschau und Import gleich */
function csvImportForm(data: unknown) {
  if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
  const file = data.get("file");
  if (!(file instanceof File)) throw new UserError("Keine Datei ausgewählt.");
  if (file.size > MAX_IMPORT_BYTES) throw new UserError("Die Datei ist größer als 5 MB.");
  let options: unknown;
  try {
    options = JSON.parse(String(data.get("options") ?? "{}"));
  } catch {
    throw new UserError("Einstellungen des Imports sind kein JSON.");
  }
  return { file, options: csvImportOptionsSchema.parse(options) };
}

export const previewCsvImportFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(csvImportForm)
  .handler(async ({ data }) => previewCsvImport(new Uint8Array(await data.file.arrayBuffer()), data.options));

export const runCsvImportFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(csvImportForm)
  .handler(async ({ data, context }) => runCsvImport(context.user.id, new Uint8Array(await data.file.arrayBuffer()), data.options));
