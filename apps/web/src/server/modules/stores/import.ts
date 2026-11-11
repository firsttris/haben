import { parseAppStoreFinanceDetail, parseGooglePlayEarnings, StatementParseError, type ParsedStoreReport, type StoreSettlement } from "@haben/import";
import { and, asc, eq, inArray } from "drizzle-orm";
import { storeStatement } from "../bank/index.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { Store } from "../../db/schema.ts";
import { loadFile } from "../../storage.ts";
import { STORE_LABELS } from "./connections.ts";
import { createSettlementDrafts, type DraftOutcome } from "./drafts.ts";

/*
 * Übernahme der archivierten Finanzberichte in das Zahlungsdienstleister-Konto des Stores: je Bericht der
 * Auszahlungsanspruch des Monats als Umsatz (bei Apple je Währung). Jeder Umsatz trägt eine feste Referenz
 * (googleplay-earnings-2026-10, appstore-finance-2026-10-USD); steht sie im Konto schon, kommt er nicht noch einmal,
 * auch wenn sich ein Umrechnungskurs inzwischen geändert hat. So lässt sich die Übernahme beliebig oft wiederholen,
 * etwa nachdem das Konto angelegt oder ein fehlender Kurs eingetragen wurde.
 */

export interface StoreImportResult {
  /** null: kein Zahlungsdienstleister-Konto für diesen Store */
  accountName: string | null;
  added: number;
  /** Neu angelegte Rechnungsentwürfe */
  drafts: number;
  messages: string[];
}

async function providerAccount(store: Store) {
  const [account] = await db
    .select({ id: schema.bankAccounts.id, name: schema.bankAccounts.name })
    .from(schema.bankAccounts)
    .where(and(eq(schema.bankAccounts.purpose, "zahlungsdienstleister"), eq(schema.bankAccounts.provider, store)))
    .orderBy(asc(schema.bankAccounts.createdAt))
    .limit(1);
  return account ?? null;
}

/** Alle Umsatzsteuer-Umrechnungskurse; die Parser fragen synchron je Währung und Monat */
async function rateLookup() {
  const rows = await db.select().from(schema.exchangeRates);
  const rates = new Map(rows.map((r) => [`${r.currency} ${r.month}`, r.rate]));
  return (currency: string, month: string) => rates.get(`${currency} ${month}`) ?? null;
}

/** Liest einen archivierten Bericht */
export function parseStoreReport(
  store: Store,
  bytes: Uint8Array,
  report: { period: string; part: string },
  rateFor: (currency: string, month: string) => string | null,
  partIndex: number,
): ParsedStoreReport {
  return store === "googleplay"
    ? // Die erste Datei eines Monats ist der Bericht, weitere sind Korrekturen
      parseGooglePlayEarnings(bytes, { period: report.period, part: partIndex === 0 ? undefined : String(partIndex + 1) })
    : parseAppStoreFinanceDetail(bytes, { period: report.period, rateFor });
}

/** Alle archivierten Berichte eines Stores, gelesen; nicht lesbare als Hinweis */
async function readReports(store: Store) {
  const reports = await db
    .select({ period: schema.storeReports.period, part: schema.storeReports.part, sha256: schema.storeReports.sha256, filename: schema.archiveFiles.filename })
    .from(schema.storeReports)
    .innerJoin(schema.archiveFiles, eq(schema.archiveFiles.id, schema.storeReports.archiveFileId))
    .where(eq(schema.storeReports.store, store))
    .orderBy(asc(schema.storeReports.period), asc(schema.storeReports.fetchedAt), asc(schema.storeReports.part));
  const rateFor = await rateLookup();
  const seenParts = new Map<string, number>();
  const parsed: { filename: string; sha256: string; report: ParsedStoreReport }[] = [];
  const messages: string[] = [];
  for (const report of reports) {
    const partIndex = seenParts.get(report.period) ?? 0;
    seenParts.set(report.period, partIndex + 1);
    try {
      parsed.push({
        filename: report.filename,
        sha256: report.sha256,
        report: parseStoreReport(store, new Uint8Array(await loadFile(report.sha256)), report, rateFor, partIndex),
      });
    } catch (error) {
      if (!(error instanceof StatementParseError)) throw error;
      messages.push(`${report.filename}: ${error.message}`);
    }
  }
  return { parsed, messages };
}

/**
 * Übernimmt alle archivierten Berichte eines Stores, die noch nicht im Konto stehen, und legt für die neu übernommenen
 * Monate Rechnungsentwürfe an die Store-Gesellschaft an (drafts.ts).
 */
export async function importStoreReports(actor: string, store: Store): Promise<StoreImportResult> {
  const label = STORE_LABELS[store];
  const account = await providerAccount(store);
  if (!account) {
    return {
      accountName: null,
      added: 0,
      drafts: 0,
      messages: [
        `Für ${label} gibt es noch kein Konto. Lege unter Bank ein Konto der Art Zahlungsdienstleister mit Anbieter ${label} an; dann übernimmt Haben die Berichte.`,
      ],
    };
  }
  const { parsed, messages } = await readReports(store);
  const result: StoreImportResult = { accountName: account.name, added: 0, drafts: 0, messages };
  const freshSettlements: StoreSettlement[] = [];

  for (const { filename, sha256, report } of parsed) {
    for (const warning of report.statement.warnings) result.messages.push(`${filename}: ${warning}`);
    const references = report.statement.transactions.map((t) => t.bankReference!);
    if (references.length === 0) continue;
    const fresh = await withActor(actor, async (tx) => {
      // Konto sperren wie storeStatement, damit zwei Übernahmen nicht beide dieselbe Referenz vermissen
      await tx.select({ id: schema.bankAccounts.id }).from(schema.bankAccounts).where(eq(schema.bankAccounts.id, account.id)).for("update");
      const present = new Set(
        (
          await tx
            .select({ ref: schema.bankTransactions.bankReference })
            .from(schema.bankTransactions)
            .where(and(eq(schema.bankTransactions.bankAccountId, account.id), inArray(schema.bankTransactions.bankReference, references)))
        ).map((r) => r.ref),
      );
      const missing = report.statement.transactions.filter((t) => !present.has(t.bankReference!)).map((t, index) => ({ ...t, index }));
      if (missing.length === 0) return [];
      await storeStatement(tx, { ...report.statement, transactions: missing }, { filename, sha256 }, account.id);
      return missing.map((t) => t.bankReference!);
    });
    result.added += fresh.length;
    freshSettlements.push(...report.settlements.filter((s) => fresh.includes(s.reference)));
  }
  if (freshSettlements.length > 0) {
    const drafts = await createSettlementDrafts(actor, store, freshSettlements);
    result.drafts = drafts.created;
    result.messages.push(...drafts.messages);
  }
  return result;
}

/** Abrechnungen der archivierten Berichte eines Stores in diesen Berichtsmonaten, auch die ohne Kurs (euro null) */
export async function archivedSettlements(store: Store, periods: string[]): Promise<StoreSettlement[]> {
  const { parsed } = await readReports(store);
  return parsed.flatMap((p) => p.report.settlements).filter((s) => periods.includes(s.period));
}

/** Rechnungsentwürfe für alle archivierten Abrechnungen, die noch keinen haben (Einstellungen › Bank) */
export async function createAllStoreDrafts(actor: string, store: Store): Promise<DraftOutcome> {
  const { parsed, messages } = await readReports(store);
  const outcome = await createSettlementDrafts(
    actor,
    store,
    parsed.flatMap((p) => p.report.settlements),
  );
  return { created: outcome.created, messages: [...messages, ...outcome.messages] };
}
