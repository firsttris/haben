import { EXPENSE_CATEGORIES } from "@haben/core";
import { loadInboxSettings } from "../inbox.ts";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  bookDocument,
  bookingIssues,
  deleteDocument,
  DocumentError,
  documentInputSchema,
  getDocument,
  listDocuments,
  MAX_DOCUMENT_SIZE,
  runExtraction,
  updateDocument,
  uploadDocument,
} from "../documents.ts";
import { extractionAvailable } from "../extraction.ts";
import { authMiddleware } from "../middleware.ts";
import { loadCompany } from "../company.ts";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { UserError } from "../errors.ts";

/** KI-Auslesung läuft nach der Antwort weiter; Fehler landen am Beleg. */
const inBackground = (work: Promise<void>) => void work.catch((error) => console.error("Belegauslesung", error));

const categoryOptions = Object.entries(EXPENSE_CATEGORIES).map(([value, { label }]) => ({ value, label }));

export const getDocuments = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const inbox = await loadInboxSettings();
    return {
      documents: await listDocuments(),
      aiAvailable: extractionAvailable(),
      inbox: inbox?.enabled ? { username: inbox.username, folder: inbox.folder, lastRunAt: inbox.lastRunAt, lastError: inbox.lastError } : null,
    };
  });

export const getDocumentDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data }) => {
    const result = await getDocument(data);
    if (!result) throw new UserError("Beleg nicht gefunden.");
    // Rohdaten der Auslesung bleiben auf dem Server
    const { extraction: _extraction, ...document } = result.document;
    const [asset] = await db.select({ id: schema.assets.id }).from(schema.assets).where(eq(schema.assets.documentId, data));
    return {
      document,
      assetId: asset?.id ?? null,
      privateShares: (await loadCompany()).privateShares,
      amounts: result.amounts,
      issues: result.document.lockedAt ? [] : bookingIssues(result.document, result.amounts),
      aiAvailable: extractionAvailable(),
      categories: categoryOptions,
    };
  });

export const uploadDocuments = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const files = data.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new UserError("Keine Datei ausgewählt.");
    if (files.length > 50) throw new UserError("Höchstens 50 Dateien auf einmal.");
    return files;
  })
  .handler(async ({ data, context }) => {
    const results: { filename: string; id?: string; duplicate?: boolean; error?: string }[] = [];
    for (const file of data) {
      // Vor dem Einlesen prüfen, die anderen Dateien laufen trotzdem durch
      if (file.size > MAX_DOCUMENT_SIZE) {
        results.push({ filename: file.name, error: `${file.name}: größer als 20 MB.` });
        continue;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await uploadDocument(context.user.id, { bytes, filename: file.name }, { background: inBackground });
        results.push({ filename: file.name, ...result });
      } catch (error) {
        if (!(error instanceof DocumentError)) throw error;
        results.push({ filename: file.name, error: error.message });
      }
    }
    return results;
  });

export const saveDocument = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), document: documentInputSchema }))
  .handler(async ({ data, context }) => {
    await updateDocument(context.user.id, data.id, data.document);
    return { ok: true };
  });

export const bookDocumentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await bookDocument(context.user.id, data);
    return { ok: true };
  });

export const deleteDocumentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await deleteDocument(context.user.id, data);
    return { ok: true };
  });

export const reextractDocument = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    if (!extractionAvailable()) throw new UserError("Die KI-Auslesung ist nicht eingerichtet (ANTHROPIC_API_KEY).");
    inBackground(runExtraction(context.user.id, data));
    return { ok: true };
  });
