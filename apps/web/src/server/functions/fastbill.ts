import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "../errors.ts";
import { authMiddleware } from "../middleware.ts";
import {
  cancelFastbillImport as cancelFastbill,
  fastbillArticlesCsv,
  fastbillReceiptScriptList,
  markFastbillWithoutReceipt,
  MAX_ARCHIVE_SIZE,
  removeFastbillKey,
  saveFastbillKey,
  startFastbillImport as startFastbill,
  uploadFastbillReceipts as uploadFastbillReceiptsZip,
} from "../modules/archiv/index.ts";

/* Umzug aus FastBill: Zugang, Abruf, Artikel für den CSV-Import und die Belege, die FastBill nur im Browser herausgibt. Status und Übersicht liefern getMigration und getImportStatus in archive.ts. */

export const saveFastbillLogin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      email: z.string().trim().min(3, "Login-E-Mail fehlt").max(200),
      apiKey: z.string().trim().min(1, "API-Schlüssel fehlt").max(200),
      callsPerHour: z.number().int(),
    }),
  )
  .handler(async ({ data, context }) => saveFastbillKey(context.user.id, data));

export const removeFastbillLogin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await removeFastbillKey(context.user.id);
    return { ok: true };
  });

export const startFastbillImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({ id: await startFastbill(context.user.id) }));

export const cancelFastbillImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => ({ cancelled: cancelFastbill(data.id) }));

/** Liste für das Browser-Skript public/fastbill-belege.js: ID und Download-Adresse der wartenden Ausgaben */
export const getFastbillReceiptScriptList = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => fastbillReceiptScriptList());

/** ZIP-Dateien aus dem Browser-Skript; archiviert wird erst beim nächsten Abruf */
export const uploadFastbillReceipts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const files = data.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new UserError("Keine Datei ausgewählt.");
    if (files.length > 20) throw new UserError("Höchstens 20 Teile auf einmal.");
    if (files.some((f) => f.size > MAX_ARCHIVE_SIZE)) throw new UserError("Ein Teil ist größer als 100 MB.");
    return { files };
  })
  .handler(async ({ data, context }) => {
    const total = { accepted: 0, unknown: 0, invalid: [] as string[] };
    for (const file of data.files) {
      const part = await uploadFastbillReceiptsZip(context.user.id, new Uint8Array(await file.arrayBuffer()));
      total.accepted += part.accepted;
      total.unknown += part.unknown;
      total.invalid.push(...part.invalid);
    }
    return total;
  });

/** Wartende Ausgaben ohne Datei archivieren lassen; ohne IDs alle wartenden */
export const markFastbillReceiptsMissing = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ ids: z.array(z.string().regex(/^\d+$/)).max(10_000).optional() }))
  .handler(async ({ data, context }) => ({ count: await markFastbillWithoutReceipt(context.user.id, data.ids) }));

/** Artikelkatalog aus FastBill als CSV für den Artikel-Import; übernommen wird erst dort nach der Vorschau */
export const getFastbillArticlesCsv = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => fastbillArticlesCsv());
