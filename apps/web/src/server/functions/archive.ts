import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  accountTotals,
  addArchiveFile,
  ARCHIVE_KINDS,
  ArchiveError,
  datevAbschluss,
  listArchiveFiles,
  listDatevBookings,
  MAX_ARCHIVE_SIZE,
  type ArchiveKind,
  attachOrderPdf,
  listOrderDocuments,
  orderArchiveOverview,
  orderDocumentDetail,
  externalImportOverview,
} from "../modules/archiv/index.ts";
import {
  cancelImport,
  connectionStatus,
  latestImport,
  legacyVoucherDetail,
  listLegacyVouchers,
  reconciliation,
  removeApiKey,
  saveApiKey,
  startImport,
  startWebImport,
} from "../modules/archiv/index.ts";
import { openItemsOverview, takeOverAll, takeOverLegacyItem } from "../modules/archiv/index.ts";
import {
  accountableImportStatus,
  AccountableError,
  analyseAccountableUpload,
  cancelAccountableImport as cancelAccountable,
  latestAccountableImport,
  MAX_ACCOUNTABLE_SIZE as MAX_ACCOUNTABLE,
  startAccountableImport as startAccountable,
} from "../modules/archiv/index.ts";
import {
  cancelSevdeskImport as cancelSevdesk,
  latestSevdeskImport,
  removeSevdeskKey,
  saveSevdeskKey,
  sevdeskConnectionStatus,
  startSevdeskImport as startSevdesk,
} from "../modules/archiv/index.ts";
import {
  cancelFastbillImport as cancelFastbill,
  FASTBILL_PLANS,
  fastbillConnectionStatus,
  latestFastbillImport,
  removeFastbillKey,
  saveFastbillKey,
  startFastbillImport as startFastbill,
} from "../modules/archiv/index.ts";
import { bbSummary, latestBuchhaltungsbutlerImport, MAX_BB_EXPORT_SIZE, previewBbExport, startBuchhaltungsbutlerImport } from "../modules/archiv/index.ts";
import { authMiddleware } from "../middleware.ts";
import { UserError } from "../errors.ts";
import { detailId, yearSchema } from "./schemas.ts";

/** Stichtag der Übernahme offener Posten; geprüft wird er im Modul (takeoverCutoffIssue) */
const stichtagSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Umzug: Verbindungen, letzte Abrufe, Abgleich je Jahr und archivierte Dateien */
export const getMigration = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ stichtag: stichtagSchema.optional() }))
  .handler(async ({ data }) => {
    const [
      connection,
      check,
      files,
      { items: openItems, cutoff, cutoffError },
      sevdeskConnection,
      sevdeskImport,
      accountableImport,
      orderArchive,
      externalImports,
      bbImport,
      fastbillConnection,
      fastbillImport,
    ] = await Promise.all([
      connectionStatus(),
      reconciliation(),
      listArchiveFiles(),
      openItemsOverview(data.stichtag),
      sevdeskConnectionStatus(),
      latestSevdeskImport(),
      latestAccountableImport(),
      orderArchiveOverview(),
      externalImportOverview(),
      latestBuchhaltungsbutlerImport(),
      fastbillConnectionStatus(),
      latestFastbillImport(),
    ]);
    return {
      connection,
      sevdeskConnection,
      sevdeskImport,
      fastbillConnection,
      fastbillImport,
      fastbillPlans: FASTBILL_PLANS.map((p) => ({ ...p })),
      bbImport,
      accountableImport,
      openItems,
      cutoff,
      cutoffError,
      ...check,
      orderArchive,
      externalImports,
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
  .validator(z.object({ source: z.enum(["lexoffice", "sevdesk", "fastbill"]) }))
  .handler(async ({ data }) => (data.source === "sevdesk" ? latestSevdeskImport() : data.source === "fastbill" ? latestFastbillImport() : latestImport()));

export const saveLexofficeKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ apiKey: z.string().trim().min(1, "Schlüssel fehlt").max(200) }))
  .handler(async ({ data, context }) => saveApiKey(context.user.id, data.apiKey));

export const removeLexofficeKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await removeApiKey(context.user.id);
    return { ok: true };
  });

export const startLexofficeImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({ id: await startImport(context.user.id) }));

/** Sicherung aus der Web-Oberfläche von Lexware Office (ZIP-Teile aus lexware-sicherung.js) übernehmen */
export const uploadLexwareBackup = createServerFn({ method: "POST" })
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
    const parts = await Promise.all(data.files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    return { id: await startWebImport(context.user.id, parts) };
  });

export const cancelLexofficeImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => ({ cancelled: cancelImport(data.id) }));

export const saveSevdeskToken = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ apiKey: z.string().trim().min(1, "Token fehlt").max(200) }))
  .handler(async ({ data, context }) => saveSevdeskKey(context.user.id, data.apiKey));

export const removeSevdeskToken = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await removeSevdeskKey(context.user.id);
    return { ok: true };
  });

export const startSevdeskImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({ id: await startSevdesk(context.user.id) }));

export const cancelSevdeskImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => ({ cancelled: cancelSevdesk(data.id) }));

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

function bbFiles(input: unknown): { files: File[] } {
  if (!(input instanceof FormData)) throw new UserError("FormData erwartet");
  const files = input.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new UserError("Keine Datei ausgewählt.");
  if (files.length > 3) throw new UserError("Höchstens datenexport.zip, BB_Buchungsstapel.csv und EXTF_Buchungsstapel.csv auswählen.");
  if (files.some((f) => f.size > MAX_BB_EXPORT_SIZE)) throw new UserError("Eine Datei ist größer als 500 MB.");
  return { files };
}

async function bbParts(files: File[]) {
  return Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
}

export const previewBuchhaltungsbutlerImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(bbFiles)
  .handler(async ({ data }) => bbSummary(await previewBbExport(await bbParts(data.files))));

export const importBuchhaltungsbutler = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(bbFiles)
  .handler(async ({ data, context }) => startBuchhaltungsbutlerImport(context.user.id, await bbParts(data.files)));

/*
 * Accountable hat keine API: Der Export (ZIP je Geschäftsjahr) wird hochgeladen, geprüft und erst auf Knopfdruck
 * übernommen. Die Analyse liefert, was der Export enthält, bevor etwas geschrieben wird.
 */

/** Ein Export je Aufruf; mehrere Jahre lädt die Oberfläche nacheinander hoch, jedes Jahr ist ein eigener Lauf. */
export const uploadAccountableExport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const files = data.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new UserError("Keine Datei ausgewählt.");
    if (files.length > 1) throw new UserError("Bitte je Aufruf einen Export (ein Geschäftsjahr) hochladen.");
    if (files[0]!.size > MAX_ACCOUNTABLE) throw new UserError("Der Export ist größer als 100 MB.");
    return { file: files[0]! };
  })
  .handler(async ({ data }) => analyseAccountableUpload(new Uint8Array(await data.file.arrayBuffer()), data.file.name));

export const startAccountableImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({ id: await startAccountable(context.user.id) }));

export const cancelAccountableImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => ({ cancelled: cancelAccountable(data.id) }));

/** Der laufende oder letzte Lauf; ohne id der letzte, sonst der, den die Oberfläche beobachtet. */
export const getAccountableStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().optional() }))
  .handler(async ({ data }) => {
    if (!data.id) return latestAccountableImport();
    const run = await accountableImportStatus(data.id);
    if (!run) throw new AccountableError("Den Lauf gibt es nicht.");
    return run;
  });

/** Hochgeladenen Export wieder verwerfen (falsche Datei); angestoßene Läufe bleiben davon unberührt. */
const kindSchema = z.enum(Object.keys(ARCHIVE_KINDS) as [ArchiveKind, ...ArchiveKind[]]);

export const uploadArchiveFiles = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const files = data.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new UserError("Keine Datei ausgewählt.");
    if (files.length > 50) throw new UserError("Höchstens 50 Dateien auf einmal.");
    if (files.some((f) => f.size > MAX_ARCHIVE_SIZE)) throw new UserError("Eine Datei ist größer als 100 MB.");
    const year = String(data.get("year") ?? "");
    return {
      files,
      kind: kindSchema.parse(data.get("kind")),
      year: year ? yearSchema.parse(Number(year)) : null,
      note: z
        .string()
        .max(500)
        .parse(data.get("note") ?? ""),
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
  .validator(({ id }: { id: string }) => ({ id: detailId(id) }))
  .handler(async ({ data }) => {
    const detail = await legacyVoucherDetail(data.id);
    if (!detail) throw notFound();
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
    const [bookings, totals, abschluss] = await Promise.all([listDatevBookings(data), accountTotals(data.year), datevAbschluss(data.year)]);
    return { ...bookings, totals, abschluss };
  });

export const takeOverOpenItem = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), stichtag: stichtagSchema }))
  .handler(async ({ data, context }) => takeOverLegacyItem(context.user.id, data.id, data.stichtag));

export const takeOverAllOpenItems = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ stichtag: stichtagSchema }))
  .handler(async ({ data, context }) => takeOverAll(context.user.id, data.stichtag));

export const getOrderDocuments = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema, search: z.string().max(100).default(""), kind: z.enum(["AN", "AB", "LI"]).optional() }))
  .handler(async ({ data }) => listOrderDocuments(data));

export const getOrderDocument = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(({ id }: { id: string }) => ({ id: detailId(id) }))
  .handler(async ({ data }) => {
    const detail = await orderDocumentDetail(data.id);
    if (!detail) throw notFound();
    return detail;
  });

export const uploadOrderPdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!(input instanceof FormData)) throw new UserError("FormData erwartet.");
    const file = input.get("file");
    if (!(file instanceof File) || file.size > 20 * 1024 * 1024) throw new UserError("Bitte ein PDF mit höchstens 20 MB auswählen.");
    return { id: z.uuid().parse(input.get("id")), file };
  })
  .handler(async ({ data, context }) =>
    attachOrderPdf(context.user.id, data.id, {
      filename: data.file.name,
      bytes: new Uint8Array(await data.file.arrayBuffer()),
    }),
  );
