import { ACCOUNT_NAMES, ACCOUNTS, ASSET_ACCOUNT_NAMES, EXPENSE_CATEGORIES, type Kontenrahmen } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware.ts";

const EXTRA_NAMES: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: {
    [ACCOUNTS.SKR03.vorsteuer[1900]]: "Vorsteuer 19 %",
    [ACCOUNTS.SKR03.vorsteuer[700]]: "Vorsteuer 7 %",
    [ACCOUNTS.SKR03.verbindlichkeiten]: "Verbindlichkeiten aus Lieferungen und Leistungen",
    [ACCOUNTS.SKR03.privateinlagen]: "Privateinlagen",
    [ACCOUNTS.SKR03.privatentnahmen]: "Privatentnahmen",
    [ACCOUNTS.SKR03.geldtransit]: "Geldtransit",
    [ACCOUNTS.SKR03.ustVorauszahlung]: "Umsatzsteuer-Vorauszahlungen",
    ...Object.fromEntries(Object.values(EXPENSE_CATEGORIES).map((c) => [c.SKR03, c.label])),
    ...ASSET_ACCOUNT_NAMES.SKR03,
  },
  SKR04: {
    [ACCOUNTS.SKR04.vorsteuer[1900]]: "Vorsteuer 19 %",
    [ACCOUNTS.SKR04.vorsteuer[700]]: "Vorsteuer 7 %",
    [ACCOUNTS.SKR04.verbindlichkeiten]: "Verbindlichkeiten aus Lieferungen und Leistungen",
    [ACCOUNTS.SKR04.privateinlagen]: "Privateinlagen",
    [ACCOUNTS.SKR04.privatentnahmen]: "Privatentnahmen",
    [ACCOUNTS.SKR04.geldtransit]: "Geldtransit",
    [ACCOUNTS.SKR04.ustVorauszahlung]: "Umsatzsteuer-Vorauszahlungen",
    ...Object.fromEntries(Object.values(EXPENSE_CATEGORIES).map((c) => [c.SKR04, c.label])),
    ...ASSET_ACCOUNT_NAMES.SKR04,
  },
};

export function accountName(kontenrahmen: Kontenrahmen, account: string): string {
  return ACCOUNT_NAMES[kontenrahmen][account] ?? EXTRA_NAMES[kontenrahmen][account] ?? "";
}

/** Buchungen eines Monats mit ihren Zeilen, nur lesend */
export const getJournal = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) }))
  .handler(async ({ data }) => {
    const start = `${data.year}-${String(data.month).padStart(2, "0")}-01`;
    const end = data.month === 12 ? `${data.year + 1}-01-01` : `${data.year}-${String(data.month + 1).padStart(2, "0")}-01`;
    const entries = await db
      .select()
      .from(schema.journalEntries)
      .where(and(gte(schema.journalEntries.date, start), lt(schema.journalEntries.date, end)))
      .orderBy(desc(schema.journalEntries.date), desc(schema.journalEntries.createdAt));
    const lines = entries.length
      ? await db
          .select()
          .from(schema.journalLines)
          .where(inArray(schema.journalLines.entryId, entries.map((e) => e.id)))
          .orderBy(asc(schema.journalLines.credit), asc(schema.journalLines.account))
      : [];
    return entries.map((entry) => ({
      id: entry.id,
      date: entry.date,
      description: entry.description,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      reversal: entry.reversesId !== null,
      lines: lines
        .filter((l) => l.entryId === entry.id)
        .map((l) => ({ ...l, name: accountName(entry.kontenrahmen, l.account) })),
    }));
  });
