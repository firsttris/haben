import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  accountTotals,
  addArchiveFile,
  ARCHIVE_KINDS,
  ArchiveError,
  listArchiveFiles,
  listDatevBookings,
  MAX_ARCHIVE_SIZE,
  type ArchiveKind,
} from "../archive.ts";
import {
  cancelImport,
  connectionStatus,
  latestImport,
  legacyVoucherDetail,
  LexofficeError,
  listLegacyVouchers,
  reconciliation,
  removeApiKey,
  saveApiKey,
  startImport,
} from "../lexoffice.ts";
import { authMiddleware } from "../middleware.ts";

function asUserError(error: unknown): never {
  if (error instanceof LexofficeError || error instanceof ArchiveError) throw new Error(error.message);
  throw error;
}

const yearSchema = z.number().int().min(2000).max(2100);

/** Umzug: Verbindung, letzter Abruf, Abgleich je Jahr und archivierte Dateien */
export const getMigration = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const [connection, check, files] = await Promise.all([connectionStatus(), reconciliation(), listArchiveFiles()]);
    return {
      connection,
      ...check,
      files: files.map(({ meta, ...file }) => ({
        ...file,
        bookings: typeof meta?.bookings === "number" ? meta.bookings : null,
        dateFrom: typeof meta?.dateFrom === "string" ? meta.dateFrom : null,
        dateTo: typeof meta?.dateTo === "string" ? meta.dateTo : null,
      })),
      kinds: Object.entries(ARCHIVE_KINDS).map(([value, label]) => ({ value: value as ArchiveKind, label })),
    };
  });

export const getImportStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => latestImport());

export const saveLexofficeKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ apiKey: z.string().trim().min(1, "Schlüssel fehlt").max(200) }))
  .handler(async ({ data, context }) => saveApiKey(context.user.id, data.apiKey).catch(asUserError));

export const removeLexofficeKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await removeApiKey(context.user.id);
    return { ok: true };
  });

export const startLexofficeImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({ id: await startImport(context.user.id).catch(asUserError) }));

export const cancelLexofficeImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => ({ cancelled: cancelImport(data.id) }));

const kindSchema = z.enum(Object.keys(ARCHIVE_KINDS) as [ArchiveKind, ...ArchiveKind[]]);

export const uploadArchiveFiles = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("FormData erwartet");
    const files = data.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new Error("Keine Datei ausgewählt.");
    if (files.length > 50) throw new Error("Höchstens 50 Dateien auf einmal.");
    if (files.some((f) => f.size > MAX_ARCHIVE_SIZE)) throw new Error("Eine Datei ist größer als 100 MB.");
    const year = String(data.get("year") ?? "");
    return {
      files,
      kind: kindSchema.parse(data.get("kind")),
      year: year ? yearSchema.parse(Number(year)) : null,
      note: z.string().max(500).parse(data.get("note") ?? ""),
    };
  })
  .handler(async ({ data, context }) => {
    const results: { filename: string; bookings?: number; warnings?: string[]; error?: string }[] = [];
    for (const file of data.files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await addArchiveFile(context.user.id, { bytes, filename: file.name, kind: data.kind, year: data.year, note: data.note });
        results.push({ filename: file.name, bookings: result.bookings, warnings: result.warnings });
      } catch (error) {
        if (!(error instanceof ArchiveError)) throw error;
        results.push({ filename: file.name, error: error.message });
      }
    }
    return results;
  });

export const getLegacyVouchers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      year: yearSchema,
      direction: z.enum(["alle", "einnahme", "ausgabe"]).default("alle"),
      search: z.string().max(100).default(""),
      ohneDatei: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => listLegacyVouchers(data));

export const getLegacyVoucher = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const detail = await legacyVoucherDetail(data.id);
    if (!detail) throw new Error("Beleg nicht gefunden.");
    return detail;
  });

export const getDatevBookings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      year: yearSchema,
      search: z.string().max(100).default(""),
      unmatched: z.boolean().default(false),
      page: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ data }) => {
    const [bookings, totals] = await Promise.all([listDatevBookings(data), accountTotals(data.year)]);
    return { ...bookings, totals };
  });
