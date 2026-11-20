import { addDays } from "@haben/core";
import { type ImportBatch, INTERNAL_PROVIDERS, isInternalProvider, statementFromBatch, validateBatch } from "@haben/import";
import { and, asc, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { sha256Of } from "../../storage.ts";
import { gebundeneKonten } from "./abruf-bindung.ts";
import { BankError } from "./bank-error.ts";
import { MovementConflictError, type BatchResult, storeBatch, type StoreBatchInput } from "./import-batch.ts";
import { recordRefusedBatch } from "./import-konflikt.ts";

/*
 * REST-Import (#306, Schritt 4): Ein Dienst außerhalb von Haben liefert Bewegungen nach dem Importvertrag. Liefern darf er
 * nur in eine Quelle, die der Nutzer am Konto freigegeben hat (Anbieter und Kontokennung beim Anbieter); ein Token allein
 * legt keine an, sonst bestimmte der Dienst, in welches Konto er liefert. Haben baut den Auszug selbst aus der Lieferung
 * (`statementFromBatch`) und speichert sie wie einen Abruf (`storeBatch`): Wiederholungen, Konflikte und der Abrufstand
 * gelten genauso. Der Import ordnet nichts zu und bucht nichts.
 */

/** Höchstens so viele Bewegungen je Lieferung; mehr kommen über mehrere Teile desselben Abrufs (`part`) */
export const MAX_MOVEMENTS = 1000;

export const externalSourceSchema = z.object({
  accountId: z.uuid(),
  provider: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9._-]{1,49}$/, "Anbieter: 2 bis 50 Zeichen, Kleinbuchstaben, Ziffern, Punkt, Binde- und Unterstrich, z. B. haben-ebay."),
  externalAccountId: z.string().trim().min(1, "Trag die Kennung des Kontos beim Anbieter ein.").max(200),
  /** Erster Tag, den die Quelle liefert; ohne Angabe der Tag nach dem letzten Umsatz des Kontos, ohne Umsatz heute */
  cutoverDate: z.iso.date().optional(),
});

/** Gibt eine Quelle am Konto frei. Der Stichtag liegt nie vor dem Tag nach dem letzten Umsatz, damit nichts doppelt kommt. */
export async function addExternalSource(actor: string, input: z.input<typeof externalSourceSchema>) {
  const data = externalSourceSchema.parse(input);
  if (isInternalProvider(data.provider)) {
    throw new BankError(`„${data.provider}“ hat in Haben eine eigene Anbindung; ihre Quelle entsteht beim Verbinden.`);
  }
  return withActor(actor, async (tx) => {
    const [account] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, data.accountId)).for("update");
    if (!account) throw new BankError("Konto nicht gefunden.");
    if (account.excludedAt) throw new BankError(`Das Konto ${account.name} ist ausgeschlossen.`);
    const [vorhanden] = await tx.select().from(schema.importSources).where(eq(schema.importSources.bankAccountId, account.id));
    if (vorhanden) throw new BankError(`Das Konto ${account.name} hat schon eine Quelle (${vorhanden.provider}); ein Konto bekommt Umsätze nur aus einer.`);
    if ((await gebundeneKonten(tx)).includes(account.id)) {
      throw new BankError(`Das Konto ${account.name} hat schon einen Abruf in Haben; ein Konto bekommt Umsätze nur aus einer Quelle.`);
    }
    const [taken] = await tx
      .select()
      .from(schema.importSources)
      .where(and(eq(schema.importSources.provider, data.provider), eq(schema.importSources.externalAccountId, data.externalAccountId)));
    if (taken) throw new BankError("Diese Kennung ist schon mit einem anderen Konto verbunden.");
    const [last] = await tx
      .select({ day: sql<string | null>`max(${schema.bankTransactions.bookingDate})::text` })
      .from(schema.bankTransactions)
      .where(eq(schema.bankTransactions.bankAccountId, account.id));
    const earliest = last?.day ? addDays(last.day, 1) : undefined;
    if (data.cutoverDate && earliest && data.cutoverDate < earliest) {
      throw new BankError(`Der Stichtag liegt frühestens am ${earliest}: Bis ${last!.day} hat das Konto schon Umsätze, sonst kämen sie doppelt.`);
    }
    const [created] = await tx
      .insert(schema.importSources)
      .values({
        bankAccountId: account.id,
        provider: data.provider,
        externalAccountId: data.externalAccountId,
        accountKind: account.purpose === "zahlungsdienstleister" ? "psp" : "bank",
        cutoverDate: data.cutoverDate ?? earliest ?? new Date().toISOString().slice(0, 10),
      })
      .returning();
    return created!;
  });
}

/** Freigegebene externe Quellen mit Abrufstand und offenen Konflikten, für die Bankseite und `GET /bankquellen` */
export async function externalSources() {
  const latest = db
    .select({
      sourceId: schema.importBatches.sourceId,
      checkpoint: sql<string | null>`max(${schema.importBatches.checkpoint})::text`.as("checkpoint"),
      lastDelivery: sql<Date | null>`max(${schema.importBatches.createdAt})`.as("last_delivery"),
    })
    .from(schema.importBatches)
    .groupBy(schema.importBatches.sourceId)
    .as("latest");
  const rows = await db
    .select({
      id: schema.importSources.id,
      accountId: schema.importSources.bankAccountId,
      accountName: schema.bankAccounts.name,
      provider: schema.importSources.provider,
      externalAccountId: schema.importSources.externalAccountId,
      accountKind: schema.importSources.accountKind,
      cutoverDate: schema.importSources.cutoverDate,
      createdAt: schema.importSources.createdAt,
      checkpoint: latest.checkpoint,
      lastDelivery: latest.lastDelivery,
      openConflicts: sql<number>`(select count(*)::int from import_conflicts c join import_movements m on m.id = c.movement_id
        where m.source_id = ${schema.importSources.id}
          and not exists (select 1 from import_resolutions r where r.conflict_id = c.id))`,
    })
    .from(schema.importSources)
    .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.importSources.bankAccountId))
    .leftJoin(latest, eq(latest.sourceId, schema.importSources.id))
    .where(and(notInArray(schema.importSources.provider, [...INTERNAL_PROVIDERS]), isNull(schema.bankAccounts.excludedAt)))
    .orderBy(asc(schema.bankAccounts.name), asc(schema.importSources.provider));
  const complete = await completeness(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, complete: complete.get(r.id) ?? false }));
}

/** Konten mit irgendeiner Quelle (`gebundeneKonten`): „Externe Quelle hinzufügen“ steht dort nicht */
export async function boundAccountIds(): Promise<string[]> {
  return gebundeneKonten(db);
}

/** Ob die jüngste Lieferung je Quelle ihren Zeitraum vollständig abgeschlossen hat */
async function completeness(sourceIds: string[]): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  for (const id of sourceIds) {
    const [last] = await db
      .select({ complete: schema.importBatches.complete })
      .from(schema.importBatches)
      .where(eq(schema.importBatches.sourceId, id))
      .orderBy(desc(schema.importBatches.createdAt))
      .limit(1);
    if (last) result.set(id, last.complete);
  }
  return result;
}

export type ExternalImportResult =
  | { status: "ok"; result: BatchResult & { replay: boolean } }
  | { status: "not_found"; message: string }
  | { status: "too_large"; message: string }
  | { status: "invalid"; message: string; problems: string[] }
  | {
      status: "conflict";
      message: string;
      conflicts: { sourceEventId: string; component: string; kind: string; bookingDate: string; amount: number }[];
    };

/** Nimmt eine Lieferung über die REST-API an; Fehler kommen als Ergebnis, damit die API sie ohne Ausnahme beantwortet */
export async function importExternalBatch(actor: string, body: unknown): Promise<ExternalImportResult> {
  const head = z.object({ provider: z.string(), externalAccountId: z.string(), movements: z.array(z.unknown()).optional() }).safeParse(body);
  if (!head.success)
    return { status: "invalid", message: "Lieferung ohne provider oder externalAccountId.", problems: ["Feld provider oder externalAccountId fehlt."] };
  const notFound = {
    status: "not_found" as const,
    message: `Die Quelle ${head.data.provider}/${head.data.externalAccountId} ist in Haben nicht freigegeben. Freigeben unter Bank › Konto › Externe Quelle hinzufügen.`,
  };
  if (isInternalProvider(head.data.provider)) return notFound;
  if ((head.data.movements?.length ?? 0) > MAX_MOVEMENTS) {
    return { status: "too_large", message: `Mehr als ${MAX_MOVEMENTS} Bewegungen in einer Lieferung; bitte auf mehrere Teile (part) verteilen.` };
  }
  const [source] = await db
    .select()
    .from(schema.importSources)
    .where(and(eq(schema.importSources.provider, head.data.provider), eq(schema.importSources.externalAccountId, head.data.externalAccountId)));
  if (!source) return notFound;
  const binding = { provider: source.provider, externalAccountId: source.externalAccountId, accountKind: source.accountKind };
  const validation = validateBatch(body, { ...binding, ...(source.cutoverDate ? { cutoverDate: source.cutoverDate } : {}) });
  if (!validation.ok)
    return { status: "invalid", message: `Lieferung entspricht nicht dem Importvertrag: ${validation.problems.join(" ")}`, problems: validation.problems };

  // Ein offener Konflikt hält die Quelle an, wie Bankabruf und Etsy-Abruf: bis zum Klären nimmt Haben nichts an
  const [offen] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.importConflicts)
    .innerJoin(schema.importMovements, eq(schema.importMovements.id, schema.importConflicts.movementId))
    .where(
      and(
        eq(schema.importMovements.sourceId, source.id),
        sql`not exists (select 1 from import_resolutions r where r.conflict_id = ${schema.importConflicts.id})`,
      ),
    );
  if (offen && offen.n > 0) {
    return {
      status: "conflict",
      message: `Die Quelle hat ${offen.n === 1 ? "einen offenen Konflikt" : `${offen.n} offene Konflikte`}. Bis er in Haben unter Bank am Konto mit „Konflikt klären“ geklärt ist, nimmt sie nichts an.`,
      conflicts: [],
    };
  }

  const batch: ImportBatch = validation.batch;
  const { statement, eventOf } = statementFromBatch(batch, source.accountKind);
  const input: StoreBatchInput = {
    batch,
    binding,
    statement,
    eventOf,
    source: { filename: `Lieferung ${source.provider} ${batch.idempotencyKey}`, sha256: sha256Of(Buffer.from(JSON.stringify(body), "utf8")) },
  };
  try {
    const result = await withActor(actor, (tx) => storeBatch(tx, input, source.bankAccountId));
    return { status: "ok", result };
  } catch (error) {
    if (!(error instanceof BankError)) throw error;
    // Abgelehnt: gespeichert ist nichts; der Grund steht wie bei Enable Banking und Etsy im Importprotokoll
    await withActor(actor, (tx) => recordRefusedBatch(tx, source.bankAccountId, input, error));
    if (error instanceof MovementConflictError) {
      return {
        status: "conflict",
        message: error.message,
        conflicts: error.conflicts.map(({ movement: m }) => ({
          sourceEventId: m.sourceEventId,
          component: m.component,
          kind: m.kind,
          bookingDate: m.bookingDate,
          amount: m.amount,
        })),
      };
    }
    // Derselbe Schlüssel mit anderem Inhalt (classifyBatch); sonst ein Grund am Konto, etwa ein ausgeschlossenes Konto
    if (error.message.includes("anderem Inhalt")) return { status: "conflict", message: error.message, conflicts: [] };
    return { status: "invalid", message: error.message, problems: [error.message] };
  }
}
