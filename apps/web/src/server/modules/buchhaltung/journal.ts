import {
  ACCOUNT_NAMES,
  ACCOUNTS,
  ASSET_ACCOUNT_NAMES,
  EXPENSE_CATEGORIES,
  LOHN_KONTO_NAMEN,
  PAUSCHALE_KONTEN,
  PRIVATE_USE_ACCOUNT_NAMES,
  SACHENTNAHME_KONTO_NAMEN,
  STEUER_KONTO_NAMEN,
  DARLEHEN_KONTO_NAMEN,
  type Kontenrahmen,
} from "@haben/core";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";

const EXTRA_NAMES: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: {
    [ACCOUNTS.SKR03.vorsteuer[1900]]: "Vorsteuer 19 %",
    [ACCOUNTS.SKR03.vorsteuer[700]]: "Vorsteuer 7 %",
    [ACCOUNTS.SKR03.vorsteuerRc]: "Abziehbare Vorsteuer nach § 13b UStG",
    [ACCOUNTS.SKR03.verbindlichkeiten]: "Verbindlichkeiten aus Lieferungen und Leistungen",
    [ACCOUNTS.SKR03.privateinlagen]: "Privateinlagen",
    [ACCOUNTS.SKR03.privatentnahmen]: "Privatentnahmen",
    [ACCOUNTS.SKR03.spenden]: "Zuwendungen, Spenden",
    [ACCOUNTS.SKR03.geldtransit]: "Geldtransit",
    [ACCOUNTS.SKR03.ustVorauszahlung]: "Umsatzsteuer-Vorauszahlungen",
    ...Object.fromEntries(Object.values(EXPENSE_CATEGORIES).map((c) => [c.SKR03, c.label])),
    ...ASSET_ACCOUNT_NAMES.SKR03,
    ...PRIVATE_USE_ACCOUNT_NAMES.SKR03,
    ...SACHENTNAHME_KONTO_NAMEN.SKR03,
    ...Object.fromEntries(Object.values(PAUSCHALE_KONTEN).map((k) => [k.SKR03.konto, k.SKR03.name])),
    ...LOHN_KONTO_NAMEN.SKR03,
    ...STEUER_KONTO_NAMEN.SKR03,
    ...DARLEHEN_KONTO_NAMEN.SKR03,
  },
  SKR04: {
    [ACCOUNTS.SKR04.vorsteuer[1900]]: "Vorsteuer 19 %",
    [ACCOUNTS.SKR04.vorsteuer[700]]: "Vorsteuer 7 %",
    [ACCOUNTS.SKR04.vorsteuerRc]: "Abziehbare Vorsteuer nach § 13b UStG",
    [ACCOUNTS.SKR04.verbindlichkeiten]: "Verbindlichkeiten aus Lieferungen und Leistungen",
    [ACCOUNTS.SKR04.privateinlagen]: "Privateinlagen",
    [ACCOUNTS.SKR04.privatentnahmen]: "Privatentnahmen",
    [ACCOUNTS.SKR04.spenden]: "Zuwendungen, Spenden",
    [ACCOUNTS.SKR04.geldtransit]: "Geldtransit",
    [ACCOUNTS.SKR04.ustVorauszahlung]: "Umsatzsteuer-Vorauszahlungen",
    ...Object.fromEntries(Object.values(EXPENSE_CATEGORIES).map((c) => [c.SKR04, c.label])),
    ...ASSET_ACCOUNT_NAMES.SKR04,
    ...PRIVATE_USE_ACCOUNT_NAMES.SKR04,
    ...SACHENTNAHME_KONTO_NAMEN.SKR04,
    ...Object.fromEntries(Object.values(PAUSCHALE_KONTEN).map((k) => [k.SKR04.konto, k.SKR04.name])),
    ...LOHN_KONTO_NAMEN.SKR04,
    ...STEUER_KONTO_NAMEN.SKR04,
    ...DARLEHEN_KONTO_NAMEN.SKR04,
  },
};

export function accountName(kontenrahmen: Kontenrahmen, account: string): string {
  return ACCOUNT_NAMES[kontenrahmen][account] ?? EXTRA_NAMES[kontenrahmen][account] ?? "";
}

/** Alle Konten mit Namen, die Haben kennt, z. B. als Hilfe beim Erfassen einer manuellen Buchung */
export function knownAccounts(kontenrahmen: Kontenrahmen): Record<string, string> {
  return { ...EXTRA_NAMES[kontenrahmen], ...ACCOUNT_NAMES[kontenrahmen] };
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
        .where(
          inArray(
            schema.journalLines.entryId,
            entries.map((e) => e.id),
          ),
        )
        .orderBy(asc(schema.journalLines.credit), asc(schema.journalLines.account))
    : [];
  // Stornierte Buchungen: Gegenbuchungen dürfen in einem anderen Monat stehen
  const reversedIds = entries.length
    ? new Set(
        (
          await db
            .select({ id: schema.journalEntries.reversesId })
            .from(schema.journalEntries)
            .where(
              inArray(
                schema.journalEntries.reversesId,
                entries.map((e) => e.id),
              ),
            )
        ).map((r) => r.id),
      )
    : new Set<string | null>();
  return entries.map((entry) => ({
    id: entry.id,
    date: entry.date,
    description: entry.description,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    reversal: entry.reversesId !== null,
    reversed: reversedIds.has(entry.id),
    lines: lines.filter((l) => l.entryId === entry.id).map((l) => ({ ...l, name: accountName(entry.kontenrahmen, l.account) })),
  }));
}

/**
 * Saldo des Geldtransitkontos (1360 bzw. 1460) über alle Jahre, Soll − Haben. Ungleich 0 heißt: zu einem Übertrag
 * zwischen eigenen Konten (oder zur Auszahlung eines Zahlungsdienstleisters) fehlt die Gegenseite.
 */
export async function transitBalance(): Promise<number> {
  const [row] = await db
    .select({ saldo: sql<string>`coalesce(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)` })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .where(
      sql`(${schema.journalEntries.kontenrahmen} = 'SKR03' and ${schema.journalLines.account} = ${ACCOUNTS.SKR03.geldtransit})
        or (${schema.journalEntries.kontenrahmen} = 'SKR04' and ${schema.journalLines.account} = ${ACCOUNTS.SKR04.geldtransit})`,
    );
  return Number(row?.saldo ?? 0);
}
