import { ownAccountProblem, type ExpenseCategory, type Kontenrahmen, OWN_ACCOUNT_NAME_MAX } from "@haben/core";
import { and, asc, eq, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { loadCompany } from "../stammdaten/index.ts";

/**
 * Eigene Sachkonten (#270, Stufe 1): ein Aufwandskonto mit eigener Nummer und eigenem Namen, das für Steuer, EÜR und
 * E-Bilanz wie seine Elternkategorie zählt. Angelegt wird im Kontenrahmen der Firma. Nummer und Elternkategorie sind danach
 * fest (Trigger, drizzle/0205); archivierte Konten bleiben für bestehende Buchungen auflösbar.
 */

export class OwnAccountError extends UserError {}

export interface OwnAccount {
  id: string;
  kontenrahmen: Kontenrahmen;
  account: string;
  name: string;
  parentCategory: ExpenseCategory;
  archivedAt: Date | null;
}

export interface OwnAccountInput {
  account: string;
  name: string;
  parentCategory: ExpenseCategory;
}

const columns = {
  id: schema.ownAccounts.id,
  kontenrahmen: schema.ownAccounts.kontenrahmen,
  account: schema.ownAccounts.account,
  name: schema.ownAccounts.name,
  parentCategory: schema.ownAccounts.parentCategory,
  archivedAt: schema.ownAccounts.archivedAt,
};

/** Alle eigenen Konten, die aktiven zuerst, dann nach Nummer */
export async function listOwnAccounts(): Promise<OwnAccount[]> {
  const rows = await db
    .select(columns)
    .from(schema.ownAccounts)
    .orderBy(sql`${schema.ownAccounts.archivedAt} is not null`, asc(schema.ownAccounts.kontenrahmen), asc(schema.ownAccounts.account));
  return rows as OwnAccount[];
}

/** Nummer → Elternkategorie für den Kontenrahmen, auch archivierte: Buchungen darauf bleiben auswertbar */
export async function loadOwnAccountParents(kontenrahmen: Kontenrahmen): Promise<Map<string, ExpenseCategory>> {
  const rows = await db
    .select({ account: schema.ownAccounts.account, parentCategory: schema.ownAccounts.parentCategory })
    .from(schema.ownAccounts)
    .where(eq(schema.ownAccounts.kontenrahmen, kontenrahmen));
  return new Map(rows.map((r) => [r.account, r.parentCategory as ExpenseCategory]));
}

export async function createOwnAccount(actor: string, input: OwnAccountInput): Promise<string> {
  const company = await loadCompany();
  const kontenrahmen = company.kontenrahmen;
  const name = input.name.trim();
  const problem = ownAccountProblem({ kontenrahmen, account: input.account, name, parentCategory: input.parentCategory });
  if (problem) throw new OwnAccountError(problem);
  return withActor(actor, async (tx) => {
    const [vorhanden] = await tx
      .select({ id: schema.ownAccounts.id })
      .from(schema.ownAccounts)
      .where(and(eq(schema.ownAccounts.kontenrahmen, kontenrahmen), eq(schema.ownAccounts.account, input.account)));
    if (vorhanden) throw new OwnAccountError(`Das Konto ${input.account} gibt es schon.`);
    // Eine Nummer, die das Journal schon kennt, bedeutete für alte Buchungen plötzlich etwas anderes
    const [gebucht] = await tx
      .select({ id: schema.journalLines.id })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
      .where(and(eq(schema.journalLines.account, input.account), eq(schema.journalEntries.kontenrahmen, kontenrahmen)))
      .limit(1);
    if (gebucht) throw new OwnAccountError(`Auf ${input.account} ist im Journal schon gebucht; bitte eine freie Nummer nehmen.`);
    const [created] = await tx
      .insert(schema.ownAccounts)
      .values({ kontenrahmen, account: input.account, name, parentCategory: input.parentCategory, createdBy: actor })
      .returning({ id: schema.ownAccounts.id });
    return created!.id;
  });
}

export async function renameOwnAccount(actor: string, id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (clean === "" || clean.length > OWN_ACCOUNT_NAME_MAX) throw new OwnAccountError(`Der Name fehlt oder ist länger als ${OWN_ACCOUNT_NAME_MAX} Zeichen.`);
  await withActor(actor, async (tx) => {
    const [konto] = await tx.select({ id: schema.ownAccounts.id }).from(schema.ownAccounts).where(eq(schema.ownAccounts.id, id)).for("update");
    if (!konto) throw new OwnAccountError("Konto nicht gefunden.");
    await tx.update(schema.ownAccounts).set({ name: clean, updatedAt: sql`now()` }).where(eq(schema.ownAccounts.id, id));
  });
}

/** Archivieren oder wieder aktivieren; ein archiviertes Konto steht nicht mehr zur Auswahl, bestehende Buchungen behalten es */
export async function setOwnAccountArchived(actor: string, id: string, archived: boolean): Promise<void> {
  await withActor(actor, async (tx) => {
    const [konto] = await tx.select().from(schema.ownAccounts).where(eq(schema.ownAccounts.id, id)).for("update");
    if (!konto) throw new OwnAccountError("Konto nicht gefunden.");
    if (archived === (konto.archivedAt !== null)) return;
    await tx
      .update(schema.ownAccounts)
      .set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()` })
      .where(eq(schema.ownAccounts.id, id));
  });
}

/** Löscht ein Konto, auf das noch nichts zeigt (nach einem Vertippen) */
export async function deleteOwnAccount(actor: string, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [konto] = await tx.select({ id: schema.ownAccounts.id }).from(schema.ownAccounts).where(eq(schema.ownAccounts.id, id)).for("update");
    if (!konto) throw new OwnAccountError("Konto nicht gefunden.");
    await tx.delete(schema.ownAccounts).where(eq(schema.ownAccounts.id, id));
  });
}
