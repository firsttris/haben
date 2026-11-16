import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "../errors.ts";
import { authMiddleware } from "../middleware.ts";
import {
  analyseSevdeskExport,
  cancelSevdeskExportImport as cancelRun,
  latestSevdeskExportImport,
  MAX_SEVDESK_EXPORT_SIZE,
  SevdeskExportError,
  sevdeskExportImportStatus,
  startSevdeskExportImport as startRun,
} from "../modules/archiv/index.ts";

/*
 * sevDesk ohne API (#1105): Die Export-ZIP „Buchungsdaten & Belegbilder“ wird hochgeladen und analysiert, übernommen wird
 * erst auf Knopfdruck. Ein Export je Aufruf.
 */

export const uploadSevdeskExport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const files = data.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length !== 1) throw new UserError("Bitte genau eine ZIP-Datei auswählen.");
    if (files[0]!.size > MAX_SEVDESK_EXPORT_SIZE) throw new UserError("Die Datei ist größer als 100 MB. Exportiere kürzere Zeiträume.");
    return { file: files[0]! };
  })
  .handler(async ({ data }) => analyseSevdeskExport(new Uint8Array(await data.file.arrayBuffer()), data.file.name));

export const startSevdeskExportImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({ id: await startRun(context.user.id) }));

export const cancelSevdeskExportImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => ({ cancelled: cancelRun(data.id) }));

/** Ohne id der letzte Lauf, sonst der, den die Oberfläche beobachtet */
export const getSevdeskExportStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().optional() }))
  .handler(async ({ data }) => {
    if (!data.id) return latestSevdeskExportImport();
    const run = await sevdeskExportImportStatus(data.id);
    if (!run) throw new SevdeskExportError("Den Lauf gibt es nicht.");
    return run;
  });
