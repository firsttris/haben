import { and, asc, eq, sql } from "drizzle-orm";
import { bankAccountIncludedSql } from "../../db/bank-open.ts";
import { db, schema } from "../../db/index.ts";

/*
 * Herkunft der abgerufenen Umsätze im Jahresarchiv (#306, 3b): je Bewegung des Importvertrags die Quelle (Anbieter,
 * Kontokennung, Stichtag), das Ereignis der Bank und der Umsatz, den Haben daraus angelegt oder per Alias verbunden hat.
 * Der Inhalt der drei Tabellen steht schon in `protokoll/audit.csv`; ohne diese Datei ließe sich aber nicht ohne Weiteres
 * nachvollziehen, warum ein Umsatz kein zweites Mal angelegt wurde. Die Lieferungen selbst stehen in `bank/importe.csv`.
 */

export const QUELLEN_HEADER = [
  "Konto",
  "Anbieter",
  "Kontokennung",
  "Stichtag",
  "Ereignis",
  "Komponente",
  "Art",
  "Buchungstag",
  "Betrag",
  "Währung",
  "Abruf",
  "Übernommen",
  "Umsatz-ID",
  "Bewegungs-ID",
];

/** Was die Datei aus dem Archiv-Umfeld braucht; als Parameter, damit dieses Modul nichts aus export.ts importiert */
export interface QuellenUmgebung {
  /** Erstes und letztes Datum des Archivjahrs */
  von: string;
  bis: string;
  money: (cents: number | null | undefined) => string;
  iso: (value: Date | null | undefined) => string;
}

/**
 * Zeilen für `bank/quellen.csv` eines Jahres, sortiert nach Konto, Buchungstag und Ereignis; `null`, wenn kein Umsatz des
 * Jahres aus dem Importvertrag kommt. Das Jahr zählt nach dem Buchungstag des Umsatzes, wie in `umsaetze.csv`.
 */
export async function quellenFuerArchiv(umgebung: QuellenUmgebung): Promise<(string | number | null)[][] | null> {
  const rows = await db
    .select({
      account: sql<string>`coalesce(${schema.bankAccounts.iban}, ${schema.bankAccounts.name})`,
      provider: schema.importSources.provider,
      externalAccountId: schema.importSources.externalAccountId,
      cutoverDate: schema.importSources.cutoverDate,
      movement: schema.importMovements,
      fetchId: schema.importBatches.fetchId,
    })
    .from(schema.importMovements)
    .innerJoin(schema.importSources, eq(schema.importSources.id, schema.importMovements.sourceId))
    .innerJoin(schema.importBatches, eq(schema.importBatches.id, schema.importMovements.batchId))
    .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.importMovements.transactionId))
    .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.bankTransactions.bankAccountId))
    .where(
      and(
        sql`${schema.bankTransactions.bookingDate} between ${umgebung.von}::date and ${umgebung.bis}::date`,
        bankAccountIncludedSql("bank_transactions.bank_account_id"),
      ),
    )
    .orderBy(
      asc(schema.bankAccounts.iban),
      asc(schema.bankTransactions.bookingDate),
      asc(schema.importMovements.sourceEventId),
      asc(schema.importMovements.component),
    );
  if (rows.length === 0) return null;
  return rows.map((r) => [
    r.account,
    r.provider,
    r.externalAccountId,
    r.cutoverDate,
    r.movement.sourceEventId,
    r.movement.component,
    r.movement.kind,
    r.movement.bookingDate,
    umgebung.money(r.movement.amount),
    r.movement.currency,
    r.fetchId,
    umgebung.iso(r.movement.createdAt),
    r.movement.transactionId,
    r.movement.id,
  ]);
}
