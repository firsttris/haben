import { ownAccountProblem, type ExpenseCategory, type Kontenrahmen, OWN_ACCOUNT_NAME_MAX } from "@haben/core";
import { and, asc, eq, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { loadCompany } from "../stammdaten/index.ts";

/**
 * Eigene Sachkonten (#270, Stufe 1): ein Aufwandskonto mit eigener Nummer und eigenem Namen, das für Steuer, EÜR und
 * E-Bilanz wie seine Elternkategorie zählt. Angelegt wird im Kontenrahmen der Firma. Nummer und Elternkategorie sind danach
 * fest (Trigger, drizzle/0211); archivierte Konten bleiben für bestehende Buchungen auflösbar.
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
export async function loadOwnAccountParents(kontenrahmen: Kontenrahmen, q: Db | Tx = db): Promise<Map<string, ExpenseCategory>> {
  const rows = await q
    .select({ account: schema.ownAccounts.account, parentCategory: schema.ownAccounts.parentCategory })
    .from(schema.ownAccounts)
    .where(eq(schema.ownAccounts.kontenrahmen, kontenrahmen));
  return new Map(rows.map((r) => [r.account, r.parentCategory as ExpenseCategory]));
}

/**
 * Namen der eigenen Konten für die synchronen Kontonamen (accountName): Schlüssel Kontenrahmen und Nummer. Die Auswertungen laden
 * sie vor dem Rechnen neu (refreshOwnAccountNames), Anlegen und Umbenennen auch.
 */
const names = new Map<string, string>();

export const ownAccountName = (kontenrahmen: Kontenrahmen, account: string): string | undefined => names.get(`${kontenrahmen}:${account}`);

/** Alle bekannten eigenen Konten des Kontenrahmens: Nummer → Name */
export const ownAccountNames = (kontenrahmen: Kontenrahmen): Record<string, string> =>
  Object.fromEntries([...names].filter(([key]) => key.startsWith(`${kontenrahmen}:`)).map(([key, name]) => [key.slice(6), name]));

export async function refreshOwnAccountNames(q: Db | Tx = db): Promise<void> {
  const rows = await q
    .select({ kontenrahmen: schema.ownAccounts.kontenrahmen, account: schema.ownAccounts.account, name: schema.ownAccounts.name })
    .from(schema.ownAccounts);
  names.clear();
  for (const r of rows) names.set(`${r.kontenrahmen}:${r.account}`, r.name);
}

/** Ob das Journal die Nummer schon kennt */
async function imJournalGebucht(q: Db | Tx, kontenrahmen: Kontenrahmen, account: string): Promise<boolean> {
  const [gebucht] = await q
    .select({ id: schema.journalLines.id })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .where(and(eq(schema.journalLines.account, account), eq(schema.journalEntries.kontenrahmen, kontenrahmen)))
    .limit(1);
  return gebucht !== undefined;
}

export async function createOwnAccount(actor: string, input: OwnAccountInput): Promise<string> {
  const company = await loadCompany();
  const kontenrahmen = company.kontenrahmen;
  const name = input.name.trim();
  const problem = ownAccountProblem({ kontenrahmen, account: input.account, name, parentCategory: input.parentCategory });
  if (problem) throw new OwnAccountError(problem);
  const id = await withActor(actor, async (tx) => {
    // Gleichzeitiges Anlegen derselben Nummer: der Zweite wartet und sieht das Konto, statt am Unique-Index zu scheitern
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`own_accounts:${kontenrahmen}:${input.account}`}))`);
    const [vorhanden] = await tx
      .select({ id: schema.ownAccounts.id })
      .from(schema.ownAccounts)
      .where(and(eq(schema.ownAccounts.kontenrahmen, kontenrahmen), eq(schema.ownAccounts.account, input.account)));
    if (vorhanden) throw new OwnAccountError(`Das Konto ${input.account} gibt es schon.`);
    // Eine Nummer, die das Journal schon kennt, bedeutete für alte Buchungen plötzlich etwas anderes
    if (await imJournalGebucht(tx, kontenrahmen, input.account))
      throw new OwnAccountError(`Auf ${input.account} ist im Journal schon gebucht; bitte eine freie Nummer nehmen.`);
    const [created] = await tx
      .insert(schema.ownAccounts)
      .values({ kontenrahmen, account: input.account, name, parentCategory: input.parentCategory, createdBy: actor })
      .returning({ id: schema.ownAccounts.id });
    return created!.id;
  });
  await refreshOwnAccountNames();
  return id;
}

export async function renameOwnAccount(actor: string, id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (clean === "" || Array.from(clean).length > OWN_ACCOUNT_NAME_MAX)
    throw new OwnAccountError(`Der Name fehlt oder ist länger als ${OWN_ACCOUNT_NAME_MAX} Zeichen.`);
  await withActor(actor, async (tx) => {
    const [konto] = await tx.select({ id: schema.ownAccounts.id }).from(schema.ownAccounts).where(eq(schema.ownAccounts.id, id)).for("update");
    if (!konto) throw new OwnAccountError("Konto nicht gefunden.");
    await tx.update(schema.ownAccounts).set({ name: clean, updatedAt: sql`now()` }).where(eq(schema.ownAccounts.id, id));
  });
  await refreshOwnAccountNames();
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
    const [konto] = await tx.select().from(schema.ownAccounts).where(eq(schema.ownAccounts.id, id)).for("update");
    if (!konto) throw new OwnAccountError("Konto nicht gefunden.");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`own_accounts:${konto.kontenrahmen}:${konto.account}`}))`);
    if (await imJournalGebucht(tx, konto.kontenrahmen, konto.account)) {
      throw new OwnAccountError(`Auf ${konto.account} ist im Journal schon gebucht; das Konto lässt sich nur archivieren.`);
    }
    await tx.delete(schema.ownAccounts).where(eq(schema.ownAccounts.id, id));
  });
  await refreshOwnAccountNames();
}
