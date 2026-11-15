import { mapSevPart, SevdeskApiError, type SevArticle, type SevdeskClient, type SevPart, type SevUnitOption, type SevUnity } from "@haben/import";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { insertArticle, listUnits } from "../stammdaten/index.ts";
import { progressMessage } from "./lexoffice.ts";

/*
 * Artikel aus sevDesk (GET /Part) in den Artikelkatalog (#472). Angelegt wird wie beim CSV-Import über insertArticle,
 * danach bekommt der Artikel die sevDesk-ID. Ein neuer Abruf überspringt jeden Artikel mit bekannter ID und überschreibt
 * nichts, was in Haben geändert wurde. Ein vorhandener Artikel mit gleicher Nummer (ohne Nummer: gleicher Bezeichnung)
 * und ohne sevDesk-Herkunft wird verknüpft statt verdoppelt, wie ein Kontakt mit gleichem Namen.
 */

function isFatal(error: unknown, signal: AbortSignal): boolean {
  if (error instanceof SevdeskApiError && (error.status === 401 || error.status === 403)) return true;
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

/** Eigene, nicht archivierte Einheiten mit ihrem UN/ECE-Code; die festen kennt resolveSevUnity selbst */
async function ownUnits(): Promise<SevUnitOption[]> {
  return (await listUnits()).filter((u) => !u.archivedAt).map((u) => ({ label: u.label, code: u.code }));
}

/** Vorhandener Artikel ohne sevDesk-Herkunft mit gleicher Nummer, ohne Nummer mit gleicher Bezeichnung */
async function sameArticle(tx: Tx, article: SevArticle): Promise<string | null> {
  const match = article.number
    ? sql`lower(trim(${schema.articles.number})) = lower(${article.number})`
    : and(eq(schema.articles.number, ""), sql`lower(trim(${schema.articles.description})) = lower(${article.description})`);
  const [row] = await tx
    .select({ id: schema.articles.id })
    .from(schema.articles)
    .where(and(isNull(schema.articles.sevdeskId), match))
    .orderBy(asc(schema.articles.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** "created" neu angelegt, "linked" mit vorhandenem verknüpft, "known" schon übernommen (gleichzeitiger Lauf) */
async function storeArticle(actor: string, article: SevArticle): Promise<"created" | "linked" | "known"> {
  return withActor(actor, async (tx) => {
    const [known] = await tx.select({ id: schema.articles.id }).from(schema.articles).where(eq(schema.articles.sevdeskId, article.sevdeskId));
    if (known) return "known";
    const same = await sameArticle(tx, article);
    if (same) {
      await tx.update(schema.articles).set({ sevdeskId: article.sevdeskId }).where(eq(schema.articles.id, same));
      return "linked";
    }
    const { sevdeskId, archived, ...input } = article;
    const row = await insertArticle(tx, input);
    await tx
      .update(schema.articles)
      .set({ sevdeskId, archivedAt: archived ? new Date() : null })
      .where(eq(schema.articles.id, row.id));
    return "created";
  });
}

export async function importSevdeskArticles(actor: string, client: SevdeskClient, progress: LexofficeImportProgress, signal: AbortSignal): Promise<void> {
  const parts: SevPart[] = [];
  const unities = new Map<string, SevUnity>();
  try {
    for await (const raw of client.parts()) parts.push(raw);
    if (parts.length === 0) return;
    for await (const unity of client.unities()) unities.set(String(unity.id), unity);
  } catch (error) {
    if (isFatal(error, signal)) throw error;
    // Artikel sind Stammdaten: Ein Fehler darf den Abruf der Belege nicht verhindern
    progress.failed.push({ lexofficeId: "part", number: "Artikel", message: progressMessage(error) });
    return;
  }
  const stats = progress.sevdeskArticles ?? { imported: 0, linked: 0, known: 0 };
  progress.sevdeskArticles = stats;
  const done = new Set((await db.select({ id: schema.articles.sevdeskId }).from(schema.articles)).flatMap((r) => (r.id ? [r.id] : [])));
  const own = await ownUnits();
  const ignored = new Map<string, number>();
  for (const raw of parts) {
    const id = String(raw.id);
    if (done.has(id)) {
      stats.known += 1;
      continue;
    }
    const label = [raw.partNumber, raw.name].filter(Boolean).join(" · ") || `Artikel ${id}`;
    const mapped = mapSevPart(raw, raw.unity?.id == null ? undefined : unities.get(String(raw.unity.id)), own);
    if (!mapped.ok) {
      progress.failed.push({ lexofficeId: `part/${id}`, number: label, message: `Artikel nicht übernommen: ${mapped.reason}` });
      continue;
    }
    try {
      const result = await storeArticle(actor, mapped.article);
      if (result === "known") stats.known += 1;
      else stats[result === "created" ? "imported" : "linked"] += 1;
      if (result === "created") for (const field of mapped.ignored) ignored.set(field, (ignored.get(field) ?? 0) + 1);
    } catch (error) {
      if (isFatal(error, signal)) throw error;
      progress.failed.push({ lexofficeId: `part/${id}`, number: label, message: `Artikel nicht übernommen: ${progressMessage(error)}` });
    }
  }
  for (const [field, count] of ignored) {
    progress.failed.push({
      lexofficeId: `part/ohne-feld/${field}`,
      number: "Artikel",
      message: `${field} bei ${count === 1 ? "1 Artikel" : `${count} Artikeln`} nicht übernommen; Haben hat dafür kein Feld`,
    });
  }
}
