import {
  ACCOUNT_NAMES,
  ACCOUNTS,
  ASSET_ACCOUNT_NAMES,
  EXPENSE_CATEGORIES,
  PAUSCHALE_KONTEN,
  PRIVATE_USE_ACCOUNT_NAMES,
  type Kontenrahmen,
} from "@haben/core";
import { and, asc, desc, gte, inArray, lt } from "drizzle-orm";
import { db, schema } from "./db/index.ts";

const EXTRA_NAMES: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: {
    [ACCOUNTS.SKR03.vorsteuer[1900]]: "Vorsteuer 19 %",
    [ACCOUNTS.SKR03.vorsteuer[700]]: "Vorsteuer 7 %",
    [ACCOUNTS.SKR03.vorsteuerRc]: "Abziehbare Vorsteuer nach § 13b UStG",
    [ACCOUNTS.SKR03.verbindlichkeiten]: "Verbindlichkeiten aus Lieferungen und Leistungen",
    [ACCOUNTS.SKR03.privateinlagen]: "Privateinlagen",
    [ACCOUNTS.SKR03.privatentnahmen]: "Privatentnahmen",
    [ACCOUNTS.SKR03.geldtransit]: "Geldtransit",
    [ACCOUNTS.SKR03.ustVorauszahlung]: "Umsatzsteuer-Vorauszahlungen",
    ...Object.fromEntries(Object.values(EXPENSE_CATEGORIES).map((c) => [c.SKR03, c.label])),
    ...ASSET_ACCOUNT_NAMES.SKR03,
    ...PRIVATE_USE_ACCOUNT_NAMES.SKR03,
    ...Object.fromEntries(Object.values(PAUSCHALE_KONTEN).map((k) => [k.SKR03.konto, k.SKR03.name])),
  },
  SKR04: {
    [ACCOUNTS.SKR04.vorsteuer[1900]]: "Vorsteuer 19 %",
    [ACCOUNTS.SKR04.vorsteuer[700]]: "Vorsteuer 7 %",
    [ACCOUNTS.SKR04.vorsteuerRc]: "Abziehbare Vorsteuer nach § 13b UStG",
    [ACCOUNTS.SKR04.verbindlichkeiten]: "Verbindlichkeiten aus Lieferungen und Leistungen",
    [ACCOUNTS.SKR04.privateinlagen]: "Privateinlagen",
    [ACCOUNTS.SKR04.privatentnahmen]: "Privatentnahmen",
    [ACCOUNTS.SKR04.geldtransit]: "Geldtransit",
    [ACCOUNTS.SKR04.ustVorauszahlung]: "Umsatzsteuer-Vorauszahlungen",
    ...Object.fromEntries(Object.values(EXPENSE_CATEGORIES).map((c) => [c.SKR04, c.label])),
    ...ASSET_ACCOUNT_NAMES.SKR04,
    ...PRIVATE_USE_ACCOUNT_NAMES.SKR04,
    ...Object.fromEntries(Object.values(PAUSCHALE_KONTEN).map((k) => [k.SKR04.konto, k.SKR04.name])),
  },
};

export function accountName(kontenrahmen: Kontenrahmen, account: string): string {
  return ACCOUNT_NAMES[kontenrahmen][account] ?? EXTRA_NAMES[kontenrahmen][account] ?? "";
}

/** Buchungen eines Monats mit ihren Zeilen, nur lesend */
export async function loadJournal(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
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
}
