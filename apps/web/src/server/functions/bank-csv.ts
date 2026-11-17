import { createServerFn } from "@tanstack/react-start";
import { UserError } from "../errors.ts";
import { authMiddleware } from "../middleware.ts";
import { csvZuordnungSchema, importCsvZuordnung } from "../modules/bank/index.ts";

/** Eine Datei und die Angaben zur Spaltenzuordnung (#1275) */
function csvZuordnungForm(data: unknown) {
  if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
  const file = data.get("file");
  if (!(file instanceof File)) throw new UserError("Keine Datei ausgewählt.");
  if (file.size > 20 * 1024 * 1024) throw new UserError("Die Datei ist größer als 20 MB.");
  let options: unknown;
  try {
    options = JSON.parse(String(data.get("options") ?? ""));
  } catch {
    throw new UserError("Die Angaben zur Zuordnung fehlen.");
  }
  return { file, options: csvZuordnungSchema.parse(options) };
}

export const importBankCsv = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(csvZuordnungForm)
  .handler(async ({ data, context }) => {
    const result = await importCsvZuordnung(context.user.id, { bytes: new Uint8Array(await data.file.arrayBuffer()), filename: data.file.name }, data.options);
    return { filename: data.file.name, ...result };
  });
