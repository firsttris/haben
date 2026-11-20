import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { bankAccountIncludedSql } from "../../db/bank-open.ts";
import { db, schema } from "../../db/index.ts";
import { iso, money } from "./csv.ts";
import { yearEnd, yearStart } from "./jahr.ts";

/*
 * Herkunft der abgerufenen Umsätze im Jahresarchiv (#306, 3b): je Bewegung des Importvertrags die Quelle (Anbieter,
 * Kontokennung, Stichtag), das Ereignis (Bankabruf, Etsy oder REST-Import) mit seinen Referenzen und der Umsatz, den Haben daraus
 * angelegt oder per Alias verbunden hat; dazu je geklärtem Konflikt die Entscheidung. Der Inhalt der Tabellen steht schon in `protokoll/audit.csv`; ohne diese
 * Dateien ließe sich aber nicht ohne Weiteres nachvollziehen, warum ein Umsatz kein zweites Mal angelegt wurde. Die
 * Lieferungen selbst stehen in `bank/importe.csv`; die Spalte „Import-ID“ verweist auf ihre Zeile dort.
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
  "Import-ID",
  "Übernommen",
  "Umsatz-ID",
  "Bewegungs-ID",
  // Referenzen der Lieferung (`import_movements.refs`); leer bei Bewegungen, die vor dieser Spalte übernommen wurden
  "Anbieterreferenz",
  "Ereigniscode",
  "EndToEndId",
  "Bezug",
  "Auszahlung",
  "Bestellung",
];

/**
 * Zeilen für `bank/quellen.csv` eines Jahres, sortiert nach Konto, Buchungstag und Ereignis; `null`, wenn kein Umsatz des
 * Jahres aus dem Importvertrag kommt. Das Jahr zählt nach dem Buchungstag des Umsatzes, wie in `umsaetze.csv`.
 */
export async function quellenFuerArchiv(year: number): Promise<(string | number | null)[][] | null> {
  const rows = await db
    .select({
      account: sql<string>`coalesce(${schema.bankAccounts.iban}, ${schema.bankAccounts.name})`,
      provider: schema.importSources.provider,
      externalAccountId: schema.importSources.externalAccountId,
      cutoverDate: schema.importSources.cutoverDate,
      movement: schema.importMovements,
      importId: schema.importBatches.bankImportId,
    })
    .from(schema.importMovements)
    .innerJoin(schema.importSources, eq(schema.importSources.id, schema.importMovements.sourceId))
    .innerJoin(schema.importBatches, eq(schema.importBatches.id, schema.importMovements.batchId))
    .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.importMovements.transactionId))
    .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.bankTransactions.bankAccountId))
    .where(
      and(
        sql`${schema.bankTransactions.bookingDate} between ${yearStart(year)}::date and ${yearEnd(year)}::date`,
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
    money(r.movement.amount),
    r.movement.currency,
    r.importId,
    iso(r.movement.createdAt),
    r.movement.transactionId,
    r.movement.id,
    r.movement.refs?.providerReference ?? null,
    r.movement.refs?.eventCode ?? null,
    r.movement.refs?.endToEndId ?? null,
    r.movement.refs?.relatedEventId ?? null,
    r.movement.refs?.payoutId ?? null,
    r.movement.refs?.orderId ?? null,
  ]);
}

export const KLAERUNGEN_HEADER = [
  "Konto",
  "Ereignis",
  "Komponente",
  "Buchungstag bisher",
  "Betrag bisher",
  "Art bisher",
  "Buchungstag geliefert",
  "Betrag geliefert",
  "Art geliefert",
  "Währung",
  "Konflikt seit",
  "Import-ID",
  "Entscheidung",
  "Umsatz-ID bisher",
  "Umsatz-ID neu",
  "Geklärt von",
  "Geklärt am",
  "Klärungs-ID",
];

const ENTSCHEIDUNG = { keep: "Bisherigen behalten", add: "Als weiteren Umsatz übernommen" } as const;

/**
 * Zeilen für `bank/klaerungen.csv`: je geklärtem Konflikt der bisherige und der gelieferte Kern, die Entscheidung und der
 * neue Umsatz; `null` ohne Klärung im Jahr. Die Zeile steht im Jahr des bisherigen und, über den Jahreswechsel, auch in dem des
 * neuen Umsatzes, damit jedes Archiv den Umsatz aus der Klärung erklärt. „Import-ID“ ist
 * der abgelehnte Abruf, der den Konflikt gemeldet hat.
 */
export async function klaerungenFuerArchiv(year: number): Promise<(string | number | null)[][] | null> {
  const bisher = alias(schema.bankTransactions, "bisher");
  const neu = alias(schema.bankTransactions, "neu");
  const rows = await db
    .select({
      account: sql<string>`coalesce(${schema.bankAccounts.iban}, ${schema.bankAccounts.name})`,
      movement: schema.importMovements,
      conflict: schema.importConflicts,
      resolution: schema.importResolutions,
    })
    .from(schema.importResolutions)
    .innerJoin(schema.importConflicts, eq(schema.importConflicts.id, schema.importResolutions.conflictId))
    .innerJoin(schema.importMovements, eq(schema.importMovements.id, schema.importConflicts.movementId))
    .innerJoin(bisher, eq(bisher.id, schema.importMovements.transactionId))
    .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, bisher.bankAccountId))
    .leftJoin(neu, eq(neu.id, schema.importResolutions.transactionId))
    .where(
      and(
        sql`(${bisher.bookingDate} between ${yearStart(year)}::date and ${yearEnd(year)}::date
          or ${neu.bookingDate} between ${yearStart(year)}::date and ${yearEnd(year)}::date)`,
        bankAccountIncludedSql("bisher.bank_account_id"),
      ),
    )
    .orderBy(asc(schema.bankAccounts.iban), asc(bisher.bookingDate), asc(schema.importResolutions.createdAt));
  if (rows.length === 0) return null;
  return rows.map((r) => [
    r.account,
    r.movement.sourceEventId,
    r.movement.component,
    r.movement.bookingDate,
    money(r.movement.amount),
    r.movement.kind,
    r.conflict.bookingDate,
    money(r.conflict.amount),
    r.conflict.kind,
    r.conflict.currency,
    iso(r.conflict.createdAt),
    r.conflict.bankImportId,
    ENTSCHEIDUNG[r.resolution.decision],
    r.movement.transactionId,
    r.resolution.transactionId,
    r.resolution.createdBy,
    iso(r.resolution.createdAt),
    r.resolution.id,
  ]);
}
