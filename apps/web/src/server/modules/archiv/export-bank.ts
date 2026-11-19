import { AUFLADUNG, WRITE_OFF_KINDS } from "@haben/core";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { bankAccountIncludedSql } from "../../db/bank-open.ts";
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

/**
 * Bankdateien des Jahres. Ergänzt invoiceNumbers um zugeordnete Rechnungen anderer Jahre und gibt die Bankkonten zurück,
 * die in die Stammdaten kommen
 */
export async function* bankFiles(
  year: number,
  invoiceNumbers: Map<string, string | null>,
  documentPaths: Map<string, string>,
): AsyncGenerator<ArchiveFile, (typeof schema.bankAccounts.$inferSelect)[]> {
  // Ein ausgeschlossenes Konto (#462) gehört nicht zu dieser Firma und fehlt im Archiv
  const accounts = await db.select().from(schema.bankAccounts).where(isNull(schema.bankAccounts.excludedAt)).orderBy(asc(schema.bankAccounts.iban));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const transactions = await db
    .select()
    .from(schema.bankTransactions)
    .where(
      and(
        gte(schema.bankTransactions.bookingDate, yearStart(year)),
        lte(schema.bankTransactions.bookingDate, yearEnd(year)),
        bankAccountIncludedSql("bank_account_id"),
      ),
    )
    .orderBy(asc(schema.bankTransactions.bookingDate), asc(schema.bankTransactions.createdAt), asc(schema.bankTransactions.id));
  const transactionById = new Map(transactions.map((t) => [t.id, t]));
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
  // Verrechnungen gegenläufiger Umsätze (#457), an denen ein Umsatz des Jahres beteiligt ist; samt Gegenzeilen. Die Umsätze
  // des Jahres wählt SQL über das Buchungsdatum: Als Liste von IDs, zweimal, sprengten sie ab 32.768 Umsätzen die
  // Grenze von 65.534 Parametern
  const yearTransactionIds = sql`(select t.id from bank_transactions t where t.booking_date between ${yearStart(year)}::date and ${yearEnd(year)}::date)`;
  const neutralizations = transactions.length
    ? await db
        .select()
        .from(schema.bankNeutralizations)
        .where(
          or(
            sql`${schema.bankNeutralizations.transactionId} in ${yearTransactionIds}`,
            sql`${schema.bankNeutralizations.counterTransactionId} in ${yearTransactionIds}`,
          ),
        )
        .orderBy(asc(schema.bankNeutralizations.createdAt), asc(schema.bankNeutralizations.id))
    : [];
  const reversedNeutralizations = new Set(neutralizations.flatMap((n) => (n.reversesId ? [n.reversesId] : [])));
  const neutralized = new Set(
    neutralizations.filter((n) => !n.reversesId && !reversedNeutralizations.has(n.id)).flatMap((n) => [n.transactionId, n.counterTransactionId]),
  );

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
        ],
        rows.map((t) => {
          const allocated = allocatedByTransaction.get(t.id) ?? 0;
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
            money(neutralized.has(t.id) ? 0 : t.amount - allocated),
            neutralized.has(t.id),
            importById.get(t.importId)?.filename ?? t.importId,
            t.id,
          ];
        }),
      ),
      compress: true,
    };
  }

  const allocatedInvoiceIds = [...new Set(allocations.map((a) => a.invoiceId).filter((id): id is string => id !== null))];
  if (allocatedInvoiceIds.some((id) => !invoiceNumbers.has(id))) {
    for (const row of await db
      .select({ id: schema.invoices.id, number: schema.invoices.number })
      .from(schema.invoices)
      .where(inArray(schema.invoices.id, allocatedInvoiceIds))) {
      invoiceNumbers.set(row.id, row.number);
    }
  }
  yield {
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
  if (neutralizations.length > 0) {
    // Gegenumsatz außerhalb des Jahres: nachladen, damit Datum und Betrag beider Seiten in der Zeile stehen
    const missing = [...new Set(neutralizations.flatMap((n) => [n.transactionId, n.counterTransactionId]))].filter((id) => !transactionById.has(id));
    const outside = missing.length > 0 ? await db.select().from(schema.bankTransactions).where(inArray(schema.bankTransactions.id, missing)) : [];
    const byId = new Map([...transactionById, ...outside.map((t) => [t.id, t] as const)]);
    yield {
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
  // Ausbuchungen des Jahres (Skonto, Forderungsausfall, erhaltenes Skonto) nach Datum der Ausbuchung
  const writeOffs = await db
    .select({ writeOff: schema.writeOffs, cashNumber: schema.cashEntries.number })
    .from(schema.writeOffs)
    // Skonto zu einer Bareinnahme: die Zeile im Kassenbuch (kasse/kassenbuch.csv), wie die Umsatz-ID bei der Bank
    .leftJoin(schema.cashEntries, eq(schema.cashEntries.id, schema.writeOffs.cashEntryId))
    .where(and(gte(schema.writeOffs.date, yearStart(year)), lte(schema.writeOffs.date, yearEnd(year))))
    .orderBy(asc(schema.writeOffs.date), asc(schema.writeOffs.createdAt), asc(schema.writeOffs.id));
  if (writeOffs.length > 0) {
    const missing = [...new Set(writeOffs.map(({ writeOff: w }) => w.invoiceId).filter((id): id is string => id !== null && !invoiceNumbers.has(id)))];
    if (missing.length > 0) {
      for (const row of await db
        .select({ id: schema.invoices.id, number: schema.invoices.number })
        .from(schema.invoices)
        .where(inArray(schema.invoices.id, missing))) {
        invoiceNumbers.set(row.id, row.number);
      }
    }
    yield {
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
  yield* bankImportFiles(year, imports, accountById);
  return accounts;
}
