import { notFound } from "@tanstack/react-router";
import { EXPENSE_CATEGORIES } from "@haben/core";
import { loadInboxSettings } from "../modules/belege/index.ts";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  bookDocument,
  bookingIssues,
  cancelDocument,
  cancellationInputSchema,
  cancellationIssues,
  documentCancellation,
  plannedCancellationDate,
  reenterDocument,
  deleteDocument,
  DocumentError,
  documentInputSchema,
  documentNavigation,
  dauerbelegName,
  getDocument,
  supplierCategory,
  listDocuments,
  MAX_DOCUMENT_SIZE,
  runExtraction,
  updateDocument,
  uploadDocument,
} from "../modules/belege/index.ts";
import { extractionAvailable, extractionSettings } from "../modules/belege/index.ts";
import { authMiddleware, readMiddleware } from "../middleware.ts";
import { listContacts, loadCompany } from "../modules/stammdaten/index.ts";
import { documentIbanCheck, documentSepaTransfers } from "../modules/bank/index.ts";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { UserError } from "../errors.ts";
import { today } from "../today.ts";
import { detailId } from "./schemas.ts";

/** KI-Auslesung läuft nach der Antwort weiter; Fehler landen am Beleg. */
const inBackground = (work: Promise<void>) => void work.catch((error) => console.error("Belegauslesung", error));

const categoryOptions = Object.entries(EXPENSE_CATEGORIES).map(([value, { label }]) => ({ value, label }));

export const getDocuments = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .handler(async ({ context }) => {
    // Postfach für Belege per E-Mail ist eine Einstellung des Inhabers
    const inbox = context.user.role === "inhaber" ? await loadInboxSettings() : null;
    return {
      documents: await listDocuments(),
      aiAvailable: extractionAvailable(),
      inbox: inbox?.enabled ? { username: inbox.username, folder: inbox.folder, lastRunAt: inbox.lastRunAt, lastError: inbox.lastError } : null,
    };
  });

export const getDocumentDetail = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(detailId)
  .handler(async ({ data }) => {
    const result = await getDocument(data);
    if (!result) throw notFound();
    // Rohdaten der Auslesung bleiben auf dem Server
    const { extraction: _extraction, ...document } = result.document;
    const [asset] = await db.select({ id: schema.assets.id }).from(schema.assets).where(eq(schema.assets.documentId, data));
    const company = await loadCompany();
    const { cancellation, reentryId } = await documentCancellation(data);
    return {
      document,
      cancellation,
      reentryId,
      // Vermerk: für diesen Beleg erzeugte SEPA-Überweisungen
      sepaTransfers: await documentSepaTransfers(data),
      // IBAN der E-Rechnung gegen die des Kontakts (#410)
      ibanCheck: await documentIbanCheck(data),
      // Was gegen einen Storno spricht; die Zahlung im Bankabgleich prüft erst der Storno selbst
      cancellationIssues: result.document.lockedAt && !cancellation ? cancellationIssues(result.document) : [],
      // Datum, das ein Storno heute bekäme: im noch offenen Zeitraum der Belegbuchung oder heute
      cancellationDate: result.document.lockedAt && !cancellation ? await plannedCancellationDate(data, today()) : null,
      today: today(),
      // Vor und zurück in der Reihenfolge der Belegliste
      navigation: documentNavigation(await listDocuments(), data),
      assetId: asset?.id ?? null,
      privateShares: company.privateShares,
      rechtsform: company.rechtsform,
      tageskurs: company.tageskurs,
      amounts: result.amounts,
      splits: result.splits,
      issues: result.document.lockedAt ? [] : bookingIssues(result.document, result.amounts, today(), result.splits),
      // Bisherige Kategorie des Lieferanten als Hinweis am Feld, nur solange der Beleg offen ist
      categoryHint: result.document.lockedAt ? null : await supplierCategory(result.document.supplierName, result.document.supplierUstId),
      aiAvailable: extractionAvailable(),
      categories: categoryOptions,
      // Lieferanten aus den Kontakten zur Auswahl im Beleg
      suppliers: (await listContacts(false, "lieferant")).map(({ id, name, ustId }) => ({ id, name, ustId })),
      // Aus einem Dauerbeleg angelegt: Name der Vorlage für den Verweis
      dauerbeleg: result.document.recurringDocumentId
        ? { id: result.document.recurringDocumentId, name: await dauerbelegName(result.document.recurringDocumentId) }
        : null,
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

/** Einstellungen › KI-Assistenten und API: welcher Anbieter Belege ausliest; ohne Schlüssel */
export const getExtractionSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => extractionSettings());

export const reextractDocument = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    if (!extractionAvailable()) throw new UserError("Die KI-Auslesung ist nicht eingerichtet (ANTHROPIC_API_KEY oder EXTRACTION_BASE_URL).");
    inBackground(runExtraction(context.user.id, data));
    return { ok: true };
  });

export const cancelDocumentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), cancellation: cancellationInputSchema }))
  .handler(async ({ data, context }) => {
    await cancelDocument(context.user.id, data.id, data.cancellation, today());
    return { ok: true };
  });

export const reenterDocumentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => ({ id: await reenterDocument(context.user.id, data) }));
