import { AUFLADUNG, WRITE_OFF_KINDS } from "@haben/core";
import { and, asc, eq, getTableColumns, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { bankAccountIncludedSql, bankDuplicateConfirmedSql, bankNeutralizedSql, bankOpenAmountSql } from "../../db/bank-open.ts";
import { db, schema } from "../../db/index.ts";
import { csv, iso, money } from "./csv.ts";
import { bankImportFiles, importsOfYear } from "./export-bankimporte.ts";
import { safeName, uniquePath } from "./export-paths.ts";
import type { ArchiveFile } from "./export-zip.ts";
import { groupBy } from "./group-by.ts";
import { yearEnd, yearStart } from "./jahr.ts";

// Bankumsätze, Zuordnungen, Verrechnungen, Ausbuchungen und Importe des Jahresarchivs

const ALLOCATION_LABELS: Record<(typeof schema.allocationKindEnum.enumValues)[number], string> = {
  invoice: "Rechnung",
  document: "Beleg",
  privat: "Privat",
  spende: "Spende (Zuwendungen, Spenden)",
  geldtransit: "Geldtransit",
  ustVorauszahlung: "USt-Vorauszahlung",
  sondervorauszahlung: "USt-Sondervorauszahlung",
  kapest: "Kapitalertragsteuer",
  lohn: "Lohn/Gehalt",
  lohnsteuer: "Lohnsteuer",
  sozialversicherung: "SV-Beiträge",
  steuer: "Steuerzahlung",
  zinsertrag: "Zinserträge",
  darlehen: "Darlehen",
  kategorie: "Direkt auf Kategorie",
  aufladung: AUFLADUNG.label,
  gebuehren: "Bankgebühren",
  mahnerloes: "Mahngebühren und Zinsen",
  kursdifferenz: "Kursdifferenz",
};

type Account = typeof schema.bankAccounts.$inferSelect;
type Transaction = typeof schema.bankTransactions.$inferSelect;
type Neutralization = typeof schema.bankNeutralizations.$inferSelect;
type YearTransaction = Awaited<ReturnType<typeof bankTransactionsForYear>>[number];

function bankTransactionsForYear(year: number) {
  return db
    .select({
      ...getTableColumns(schema.bankTransactions),
      open: bankOpenAmountSql.mapWith(Number),
      neutralized: bankNeutralizedSql.mapWith(Boolean),
      duplicate: bankDuplicateConfirmedSql.mapWith(Boolean),
    })
    .from(schema.bankTransactions)
    .where(
      and(
        gte(schema.bankTransactions.bookingDate, yearStart(year)),
        lte(schema.bankTransactions.bookingDate, yearEnd(year)),
        bankAccountIncludedSql("bank_account_id"),
      ),
    )
    .orderBy(asc(schema.bankTransactions.bookingDate), asc(schema.bankTransactions.createdAt), asc(schema.bankTransactions.id));
}

/**
 * Bankdateien des Jahres. Ergänzt invoiceNumbers um zugeordnete Rechnungen anderer Jahre und gibt die Bankkonten zurück,
 * die in die Stammdaten kommen
 */
export async function* bankFiles(
  year: number,
  invoiceNumbers: Map<string, string | null>,
  documentPaths: Map<string, string>,
): AsyncGenerator<ArchiveFile, Account[]> {
  // Ein ausgeschlossenes Konto (#462) gehört nicht zu dieser Firma und fehlt im Archiv
  const accounts = await db.select().from(schema.bankAccounts).where(isNull(schema.bankAccounts.excludedAt)).orderBy(asc(schema.bankAccounts.iban));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const transactions = await bankTransactionsForYear(year);
  const transactionById = new Map<string, Transaction>(transactions.map((t) => [t.id, t]));
  const allocations = transactions.length
    ? await db
        .select()
        .from(schema.allocations)
        .where(
          inArray(
            schema.allocations.transactionId,
            transactions.map((t) => t.id),
          ),
        )
        .orderBy(asc(schema.allocations.createdAt), asc(schema.allocations.id))
    : [];
  const imports = await importsOfYear(year);
  const importById = new Map(imports.map((i) => [i.id, i]));

  const allocatedByTransaction = new Map<string, number>();
  for (const a of allocations) allocatedByTransaction.set(a.transactionId, (allocatedByTransaction.get(a.transactionId) ?? 0) + a.amount);
  const neutralizations = transactions.length ? await neutralizationsOfYear(year) : [];

  yield* transactionFiles(transactions, accountById, (t) => ({
    allocated: allocatedByTransaction.get(t.id) ?? 0,
    importFile: importById.get(t.importId)?.filename ?? t.importId,
  }));
  yield await allocationsFile(allocations, transactionById, accountById, invoiceNumbers, documentPaths);
  if (neutralizations.length > 0) yield await neutralizationsFile(neutralizations, transactionById, accountById);
  const writeOffs = await writeOffsFile(year, invoiceNumbers, documentPaths);
  if (writeOffs) yield writeOffs;
  yield* bankImportFiles(year, imports, accountById);
  return accounts;
}

/**
 * Verrechnungen gegenläufiger Umsätze (#457), an denen ein Umsatz des Jahres beteiligt ist; samt Gegenzeilen. Die Umsätze
 * des Jahres wählt SQL über das Buchungsdatum: Als Liste von IDs, zweimal, sprengten sie ab 32.768 Umsätzen die
 * Grenze von 65.534 Parametern
 */
async function neutralizationsOfYear(year: number): Promise<Neutralization[]> {
  const yearTransactionIds = sql`(select t.id from bank_transactions t where t.booking_date between ${yearStart(year)}::date and ${yearEnd(year)}::date)`;
  return db
    .select()
    .from(schema.bankNeutralizations)
    .where(
      or(
        sql`${schema.bankNeutralizations.transactionId} in ${yearTransactionIds}`,
        sql`${schema.bankNeutralizations.counterTransactionId} in ${yearTransactionIds}`,
      ),
    )
    .orderBy(asc(schema.bankNeutralizations.createdAt), asc(schema.bankNeutralizations.id));
}

/** Je Konto die umsaetze.csv mit zugeordnetem, offenem und verrechnetem Betrag */
function* transactionFiles(
  transactions: YearTransaction[],
  accountById: Map<string, Account>,
  stateOf: (t: YearTransaction) => { allocated: number; importFile: string },
): Generator<ArchiveFile> {
  const usedBankPaths = new Set<string>();
  for (const [accountId, rows] of groupBy(transactions, (t) => t.bankAccountId)) {
    const account = accountById.get(accountId);
    yield {
      path: uniquePath(usedBankPaths, `bank/${safeName(account?.iban ?? account?.name ?? accountId, 40)}/umsaetze.csv`),
      content: csv(
        [
          "Buchungsdatum",
          "Wertstellung",
          "Betrag",
          "Währung",
          "Gegenpartei",
          "Gegen-IBAN",
          "Verwendungszweck",
          "Umsatztyp",
          "Bankreferenz",
          "Zugeordnet",
          "Offen",
          "Verrechnet",
          "Importdatei",
          "Umsatz-ID",
          "Dublette",
        ],
        rows.map((t) => {
          const { allocated, importFile } = stateOf(t);
          return [
            t.bookingDate,
            t.valueDate,
            money(t.amount),
            t.currency,
            t.counterpartyName,
            t.counterpartyIban,
            t.purpose,
            t.type,
            t.bankReference,
            money(allocated),
            money(t.open),
            t.neutralized,
            importFile,
            t.id,
            t.duplicate,
          ];
        }),
      ),
      compress: true,
    };
  }
}

/** Ergänzt invoiceNumbers um die Nummern der Rechnungen, die noch fehlen (andere Jahre) */
async function addInvoiceNumbers(invoiceNumbers: Map<string, string | null>, ids: string[]): Promise<void> {
  for (const row of await db.select({ id: schema.invoices.id, number: schema.invoices.number }).from(schema.invoices).where(inArray(schema.invoices.id, ids))) {
    invoiceNumbers.set(row.id, row.number);
  }
}

/** bank/zuordnungen.csv: alle Zuordnungen der Umsätze des Jahres */
async function allocationsFile(
  allocations: (typeof schema.allocations.$inferSelect)[],
  transactionById: Map<string, Transaction>,
  accountById: Map<string, Account>,
  invoiceNumbers: Map<string, string | null>,
  documentPaths: Map<string, string>,
): Promise<ArchiveFile> {
  const allocatedInvoiceIds = [...new Set(allocations.map((a) => a.invoiceId).filter((id): id is string => id !== null))];
  if (allocatedInvoiceIds.some((id) => !invoiceNumbers.has(id))) await addInvoiceNumbers(invoiceNumbers, allocatedInvoiceIds);
  return {
    path: "bank/zuordnungen.csv",
    content: csv(
      ["Buchungsdatum", "Konto", "Art", "Rechnung", "Beleg", "Betrag", "Hebt auf", "Angelegt", "Umsatz-ID", "Rechnungs-ID", "Beleg-ID", "Zuordnungs-ID"],
      allocations.map((a) => {
        const t = transactionById.get(a.transactionId);
        return [
          t?.bookingDate,
          t ? (accountById.get(t.bankAccountId)?.iban ?? accountById.get(t.bankAccountId)?.name) : "",
          ALLOCATION_LABELS[a.kind],
          a.invoiceId ? (invoiceNumbers.get(a.invoiceId) ?? "") : "",
          a.documentId ? (documentPaths.get(a.documentId)?.replace(/^belege\//, "") ?? "") : "",
          money(a.amount),
          a.reversesId,
          iso(a.createdAt),
          a.transactionId,
          a.invoiceId,
          a.documentId,
          a.id,
        ];
      }),
    ),
    compress: true,
  };
}

/** bank/verrechnungen.csv; ein Gegenumsatz außerhalb des Jahres wird nachgeladen, damit Datum und Betrag beider Seiten in der Zeile stehen */
async function neutralizationsFile(
  neutralizations: Neutralization[],
  transactionById: Map<string, Transaction>,
  accountById: Map<string, Account>,
): Promise<ArchiveFile> {
  const missing = [...new Set(neutralizations.flatMap((n) => [n.transactionId, n.counterTransactionId]))].filter((id) => !transactionById.has(id));
  const outside = missing.length > 0 ? await db.select().from(schema.bankTransactions).where(inArray(schema.bankTransactions.id, missing)) : [];
  const byId = new Map([...transactionById, ...outside.map((t) => [t.id, t] as const)]);
  return {
    path: "bank/verrechnungen.csv",
    content: csv(
      [
        "Konto",
        "Buchungsdatum",
        "Betrag",
        "Gegenumsatz Buchungsdatum",
        "Gegenumsatz Betrag",
        "Notiz",
        "Hebt auf",
        "Angelegt",
        "Umsatz-ID",
        "Gegenumsatz-ID",
        "Verrechnungs-ID",
      ],
      neutralizations.map((n) => {
        const t = byId.get(n.transactionId);
        const c = byId.get(n.counterTransactionId);
        return [
          t ? (accountById.get(t.bankAccountId)?.iban ?? accountById.get(t.bankAccountId)?.name) : "",
          t?.bookingDate,
          money(t?.amount),
          c?.bookingDate,
          money(c?.amount),
          n.note,
          n.reversesId,
          iso(n.createdAt),
          n.transactionId,
          n.counterTransactionId,
          n.id,
        ];
      }),
    ),
    compress: true,
  };
}

/** bank/ausbuchungen.csv: Ausbuchungen des Jahres (Skonto, Forderungsausfall, erhaltenes Skonto) nach Datum; null ohne Ausbuchung */
async function writeOffsFile(year: number, invoiceNumbers: Map<string, string | null>, documentPaths: Map<string, string>): Promise<ArchiveFile | null> {
  const writeOffs = await db
    .select({ writeOff: schema.writeOffs, cashNumber: schema.cashEntries.number })
    .from(schema.writeOffs)
    // Skonto zu einer Bareinnahme: die Zeile im Kassenbuch (kasse/kassenbuch.csv), wie die Umsatz-ID bei der Bank
    .leftJoin(schema.cashEntries, eq(schema.cashEntries.id, schema.writeOffs.cashEntryId))
    .where(and(gte(schema.writeOffs.date, yearStart(year)), lte(schema.writeOffs.date, yearEnd(year))))
    .orderBy(asc(schema.writeOffs.date), asc(schema.writeOffs.createdAt), asc(schema.writeOffs.id));
  if (writeOffs.length === 0) return null;
  const missing = [...new Set(writeOffs.map(({ writeOff: w }) => w.invoiceId).filter((id): id is string => id !== null && !invoiceNumbers.has(id)))];
  if (missing.length > 0) await addInvoiceNumbers(invoiceNumbers, missing);
  return {
    path: "bank/ausbuchungen.csv",
    content: csv(
      ["Datum", "Art", "Rechnung", "Beleg", "Betrag", "Hebt auf", "Angelegt", "Umsatz-ID", "Rechnungs-ID", "Beleg-ID", "Ausbuchungs-ID", "Kassenbuch-Nr."],
      writeOffs.map(({ writeOff: w, cashNumber }) => [
        w.date,
        WRITE_OFF_KINDS[w.kind],
        w.invoiceId ? (invoiceNumbers.get(w.invoiceId) ?? "") : "",
        w.documentId ? (documentPaths.get(w.documentId)?.replace(/^belege\//, "") ?? "") : "",
        money(w.amount),
        w.reversesId,
        iso(w.createdAt),
        w.transactionId,
        w.invoiceId,
        w.documentId,
        w.id,
        cashNumber,
      ]),
    ),
    compress: true,
  };
}
