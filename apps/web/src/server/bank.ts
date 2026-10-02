import {
  computeInvoiceTotals,
  directPosting,
  documentPaymentPosting,
  invoicePaymentPosting,
  suggestMatches,
  type DirectBooking,
  type OpenItem,
  type PostingLine,
} from "@haben/core";
import { checkBalanceContinuity, parseStatement, StatementParseError, withDedupHashes } from "@haben/import";
import { and, asc, desc, eq, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { loadCompany } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { db, schema, type Tx } from "./db/index.ts";
import { sha256Of } from "./storage.ts";

export class BankError extends Error {}

const normalizeIban = (iban: string) => iban.replace(/\s/g, "").toUpperCase();

export const accountSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(100),
  iban: z
    .string()
    .transform(normalizeIban)
    .pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, "IBAN ungültig")),
});

export async function listAccounts() {
  const accounts = await db.select().from(schema.bankAccounts).orderBy(asc(schema.bankAccounts.name));
  return Promise.all(
    accounts.map(async (account) => {
      const [last] = await db
        .select({ periodTo: schema.bankImports.periodTo, closingBalance: schema.bankImports.closingBalance, createdAt: schema.bankImports.createdAt, format: schema.bankImports.format })
        .from(schema.bankImports)
        .where(eq(schema.bankImports.bankAccountId, account.id))
        .orderBy(desc(schema.bankImports.periodTo), desc(schema.bankImports.createdAt))
        .limit(1);
      const [open] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.bankTransactions)
        .where(and(eq(schema.bankTransactions.bankAccountId, account.id), sql`${openAmountSql} <> 0`));
      return { ...account, lastImport: last ?? null, openCount: open?.n ?? 0 };
    }),
  );
}

export async function createAccount(actor: string, input: z.infer<typeof accountSchema>) {
  return withActor(actor, async (tx) => {
    const [existing] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.iban, input.iban));
    if (existing) throw new BankError("Ein Konto mit dieser IBAN gibt es schon.");
    const [created] = await tx.insert(schema.bankAccounts).values(input).returning();
    return created!;
  });
}

export interface ImportResult {
  accountId: string;
  accountName: string;
  added: number;
  skipped: number;
  warnings: string[];
  gap: string | null;
}

/**
 * Importiert eine Kontoauszugsdatei. Bereits vorhandene Umsätze (gleicher Hash) werden übersprungen,
 * eine Lücke zum vorigen Import wird gemeldet.
 */
export async function importStatement(actor: string, file: { bytes: Uint8Array; filename: string }, accountId: string | null): Promise<ImportResult> {
  let statement;
  try {
    statement = parseStatement(file.bytes, file.filename);
  } catch (error) {
    if (error instanceof StatementParseError) throw new BankError(`${file.filename}: ${error.message}`);
    throw error;
  }

  return withActor(actor, async (tx) => {
    let account: typeof schema.bankAccounts.$inferSelect | undefined;
    const fileIban = statement.accountIban ? normalizeIban(statement.accountIban) : null;
    if (accountId) {
      [account] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, accountId));
      if (!account) throw new BankError("Konto nicht gefunden.");
      if (fileIban && fileIban !== account.iban) {
        throw new BankError(`Die Datei gehört zum Konto ${fileIban}, nicht zu ${account.name}.`);
      }
    } else if (fileIban) {
      [account] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.iban, fileIban));
      if (!account) {
        [account] = await tx
          .insert(schema.bankAccounts)
          .values({ iban: fileIban, name: statement.accountName || `Konto …${fileIban.slice(-4)}` })
          .returning();
      }
    } else {
      throw new BankError(`${file.filename}: Die Datei nennt keine IBAN. Bitte das Konto auswählen.`);
    }

    const [previous] = await tx
      .select({ closingBalance: schema.bankImports.closingBalance, periodTo: schema.bankImports.periodTo })
      .from(schema.bankImports)
      .where(
        and(
          eq(schema.bankImports.bankAccountId, account!.id),
          statement.periodFrom ? lte(schema.bankImports.periodTo, statement.periodFrom) : sql`true`,
        ),
      )
      .orderBy(desc(schema.bankImports.periodTo), desc(schema.bankImports.createdAt))
      .limit(1);
    const continuity = checkBalanceContinuity(
      previous ? { closingBalance: previous.closingBalance ?? undefined, periodTo: previous.periodTo ?? undefined } : null,
      { openingBalance: statement.openingBalance, periodFrom: statement.periodFrom },
    );

    // Konto sperren, damit parallele Importe dieselben Umsätze nicht doppelt anlegen
    await tx.select({ id: schema.bankAccounts.id }).from(schema.bankAccounts).where(eq(schema.bankAccounts.id, account!.id)).for("update");
    const transactions = withDedupHashes(statement.transactions);
    const known = new Set(
      transactions.length === 0
        ? []
        : (
            await tx
              .select({ hash: schema.bankTransactions.dedupHash })
              .from(schema.bankTransactions)
              .where(
                and(
                  eq(schema.bankTransactions.bankAccountId, account!.id),
                  inArray(schema.bankTransactions.dedupHash, transactions.map((t) => t.dedupHash)),
                ),
              )
          ).map((r) => r.hash),
    );
    const fresh = transactions.filter((t) => !known.has(t.dedupHash));
    const added = fresh.length;
    const [imported] = await tx
      .insert(schema.bankImports)
      .values({
        bankAccountId: account!.id,
        filename: file.filename.slice(0, 200),
        sha256: sha256Of(file.bytes),
        format: statement.format,
        periodFrom: statement.periodFrom ?? null,
        periodTo: statement.periodTo ?? null,
        openingBalance: statement.openingBalance ?? null,
        closingBalance: statement.closingBalance ?? null,
        added,
        skipped: transactions.length - added,
        warnings: statement.warnings,
      })
      .returning();
    if (fresh.length > 0) {
      await tx.insert(schema.bankTransactions).values(
        fresh.map((t) => ({
          bankAccountId: account!.id,
          importId: imported!.id,
          bookingDate: t.bookingDate,
          valueDate: t.valueDate ?? null,
          amount: t.amount,
          currency: t.currency,
          counterpartyName: t.counterpartyName,
          counterpartyIban: t.counterpartyIban ? normalizeIban(t.counterpartyIban) : null,
          purpose: t.purpose,
          type: t.type ?? null,
          bankReference: t.bankReference ?? null,
          dedupHash: t.dedupHash,
        })),
      );
    }

    return {
      accountId: account!.id,
      accountName: account!.name,
      added,
      skipped: transactions.length - added,
      warnings: statement.warnings,
      gap: continuity.ok ? null : (continuity.message ?? "Lücke zum vorigen Import"),
    };
  });
}

/** Noch nicht zugeordneter Teil eines Umsatzes */
// Tabelle ausdrücklich nennen: in der Spaltenliste schreibt drizzle nur "id", das träfe a.id
const openAmountSql = sql<number>`(${schema.bankTransactions.amount} - coalesce((select sum(a.amount) from allocations a where a.transaction_id = bank_transactions.id), 0))`;

export type TransactionFilter = "offen" | "zugeordnet" | "alle";

export async function listTransactions(accountId: string, filter: TransactionFilter, search: string) {
  const conditions = [eq(schema.bankTransactions.bankAccountId, accountId)];
  if (filter === "offen") conditions.push(sql`${openAmountSql} <> 0`);
  if (filter === "zugeordnet") conditions.push(sql`${openAmountSql} = 0`);
  if (search.trim()) {
    const term = `%${search.trim()}%`;
    conditions.push(
      or(
        ilike(schema.bankTransactions.counterpartyName, term),
        ilike(schema.bankTransactions.purpose, term),
        sql`(${schema.bankTransactions.amount}::numeric / 100)::text like ${`%${search.trim().replace(",", ".")}%`}`,
      )!,
    );
  }
  return db
    .select({
      id: schema.bankTransactions.id,
      bookingDate: schema.bankTransactions.bookingDate,
      amount: schema.bankTransactions.amount,
      counterpartyName: schema.bankTransactions.counterpartyName,
      counterpartyIban: schema.bankTransactions.counterpartyIban,
      purpose: schema.bankTransactions.purpose,
      open: openAmountSql.mapWith(Number),
    })
    .from(schema.bankTransactions)
    .where(and(...conditions))
    .orderBy(desc(schema.bankTransactions.bookingDate), desc(schema.bankTransactions.createdAt))
    .limit(500);
}

/** Bezahlter Betrag je Rechnung bzw. Beleg (Summe der Zuordnungen, Vorzeichen wie auf dem Konto) */
async function paidByTarget(column: "invoice_id" | "document_id", ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<{ id: string; paid: string }>(
    sql`select ${sql.raw(column)} as id, sum(amount) as paid from allocations where ${sql.raw(column)} in ${ids} group by 1`,
  );
  return new Map([...rows].map((r) => [r.id, Number(r.paid)]));
}

export async function invoicePayments(ids: string[]) {
  return paidByTarget("invoice_id", ids);
}

/**
 * Offen bei einer Stornorechnung: Rechnung und Storno heben sich auf, übrig bleibt, was auf die Rechnung
 * schon gezahlt und noch nicht erstattet wurde (negativ, also eine Auszahlung).
 */
export function stornoOpen(paidOnOriginal: number, paidOnStorno: number): number {
  return -paidOnOriginal - paidOnStorno;
}

/** Offene Rechnungen und Belege für den Abgleich */
export async function openItems(): Promise<OpenItem[]> {
  const invoices = await db
    .select({
      id: schema.invoices.id,
      kind: schema.invoices.kind,
      number: schema.invoices.number,
      issueDate: schema.invoices.issueDate,
      dueDate: schema.invoices.dueDate,
      gross: schema.invoices.gross,
      buyer: schema.invoices.buyer,
      contactIban: schema.contacts.iban,
    })
    .from(schema.invoices)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
    .where(and(eq(schema.invoices.status, "final"), inArray(schema.invoices.kind, ["rechnung", "korrektur"])));
  const stornos = await db
    .select({
      id: schema.invoices.id,
      correctsId: schema.invoices.correctsId,
      number: schema.invoices.number,
      issueDate: schema.invoices.issueDate,
      buyer: schema.invoices.buyer,
      contactIban: schema.contacts.iban,
    })
    .from(schema.invoices)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
    .where(and(eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")));
  const cancelled = new Set(stornos.map((r) => r.correctsId));
  const invoicePaid = await paidByTarget("invoice_id", [...invoices.map((i) => i.id), ...stornos.map((st) => st.id)]);

  const documents = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.status, "gebucht"), eq(schema.documents.payment, "bank")));
  const documentPaid = await paidByTarget("document_id", documents.map((d) => d.id));

  const items: OpenItem[] = [];
  for (const inv of invoices) {
    if (cancelled.has(inv.id)) continue;
    const open = inv.gross - (invoicePaid.get(inv.id) ?? 0);
    if (open === 0) continue;
    items.push({
      type: "invoice",
      id: inv.id,
      number: inv.number!,
      date: inv.issueDate,
      dueDate: inv.dueDate,
      open,
      partyName: inv.buyer?.name ?? "",
      partyIbans: inv.contactIban ? [inv.contactIban] : [],
    });
  }
  // Storno einer schon bezahlten Rechnung: die Erstattung wird der Stornorechnung zugeordnet
  for (const storno of stornos) {
    const open = stornoOpen(invoicePaid.get(storno.correctsId!) ?? 0, invoicePaid.get(storno.id) ?? 0);
    if (open === 0) continue;
    items.push({
      type: "invoice",
      id: storno.id,
      number: storno.number!,
      date: storno.issueDate,
      dueDate: storno.issueDate,
      open,
      partyName: storno.buyer?.name ?? "",
      partyIbans: storno.contactIban ? [storno.contactIban] : [],
    });
  }
  for (const doc of documents) {
    const open = -doc.gross - (documentPaid.get(doc.id) ?? 0);
    if (open === 0) continue;
    items.push({
      type: "document",
      id: doc.id,
      number: doc.invoiceNumber,
      date: doc.documentDate ?? doc.uploadedAt.toISOString().slice(0, 10),
      dueDate: doc.dueDate,
      open,
      partyName: doc.supplierName,
      partyIbans: [],
    });
  }
  return items;
}

export async function transactionDetail(id: string) {
  const [tx] = await db
    .select({
      id: schema.bankTransactions.id,
      bankAccountId: schema.bankTransactions.bankAccountId,
      bookingDate: schema.bankTransactions.bookingDate,
      valueDate: schema.bankTransactions.valueDate,
      amount: schema.bankTransactions.amount,
      currency: schema.bankTransactions.currency,
      counterpartyName: schema.bankTransactions.counterpartyName,
      counterpartyIban: schema.bankTransactions.counterpartyIban,
      purpose: schema.bankTransactions.purpose,
      type: schema.bankTransactions.type,
      open: openAmountSql.mapWith(Number),
    })
    .from(schema.bankTransactions)
    .where(eq(schema.bankTransactions.id, id));
  if (!tx) return null;
  const allocationRows = await db
    .select({
      id: schema.allocations.id,
      kind: schema.allocations.kind,
      amount: schema.allocations.amount,
      reversesId: schema.allocations.reversesId,
      createdAt: schema.allocations.createdAt,
      invoiceId: schema.allocations.invoiceId,
      invoiceNumber: schema.invoices.number,
      documentId: schema.allocations.documentId,
      documentSupplier: schema.documents.supplierName,
      documentNumber: schema.documents.invoiceNumber,
    })
    .from(schema.allocations)
    .leftJoin(schema.invoices, eq(schema.invoices.id, schema.allocations.invoiceId))
    .leftJoin(schema.documents, eq(schema.documents.id, schema.allocations.documentId))
    .where(eq(schema.allocations.transactionId, id))
    .orderBy(asc(schema.allocations.createdAt));
  const reversed = new Set(allocationRows.filter((a) => a.reversesId).map((a) => a.reversesId));
  const allocations = allocationRows
    .filter((a) => !a.reversesId)
    .map((a) => ({ ...a, reversed: reversed.has(a.id) }));

  const items = tx.open === 0 ? [] : await openItems();
  // Vorschläge für den noch offenen Teil des Umsatzes
  const suggestions = tx.open === 0 ? [] : suggestMatches({ ...tx, amount: tx.open }, items);
  const candidates = items.filter((i) => Math.sign(i.open) === Math.sign(tx.amount));
  return { transaction: tx, allocations, suggestions, candidates };
}

function reverseLines(lines: PostingLine[]): PostingLine[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}

async function postEntry(tx: Tx, input: { date: string; description: string; sourceId: string; lines: PostingLine[]; reversesId?: string | null }) {
  const company = await loadCompany();
  const [entry] = await tx
    .insert(schema.journalEntries)
    .values({
      date: input.date,
      description: input.description,
      sourceType: "allocation",
      sourceId: input.sourceId,
      kontenrahmen: company.kontenrahmen,
      reversesId: input.reversesId ?? null,
    })
    .returning();
  await tx.insert(schema.journalLines).values(input.lines.map((line) => ({ entryId: entry!.id, ...line })));
  await tx.update(schema.journalEntries).set({ lockedAt: new Date() }).where(eq(schema.journalEntries.id, entry!.id));
}

export const allocationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("invoice"), transactionId: z.uuid(), invoiceId: z.uuid(), amount: z.number().int() }),
  z.object({ kind: z.literal("document"), transactionId: z.uuid(), documentId: z.uuid(), amount: z.number().int() }),
  z.object({
    kind: z.enum(["privat", "geldtransit", "ustVorauszahlung", "gebuehren"]),
    transactionId: z.uuid(),
    amount: z.number().int(),
  }),
]);

export type AllocationInput = z.infer<typeof allocationSchema>;

/** Ordnet (einen Teil) eines Umsatzes zu und bucht die Zahlung. */
export async function allocate(actor: string, input: AllocationInput): Promise<void> {
  const company = await loadCompany();
  await withActor(actor, async (tx) => {
    const [bank] = await tx
      .select({ id: schema.bankTransactions.id, amount: schema.bankTransactions.amount, bookingDate: schema.bankTransactions.bookingDate, counterpartyName: schema.bankTransactions.counterpartyName, counterpartyIban: schema.bankTransactions.counterpartyIban, open: openAmountSql.mapWith(Number) })
      .from(schema.bankTransactions)
      .where(eq(schema.bankTransactions.id, input.transactionId))
      .for("update");
    if (!bank) throw new BankError("Umsatz nicht gefunden.");
    if (input.amount === 0 || Math.sign(input.amount) !== Math.sign(bank.amount)) {
      throw new BankError("Der Betrag muss das Vorzeichen des Umsatzes haben.");
    }
    if (Math.abs(input.amount) > Math.abs(bank.open)) {
      throw new BankError("Der Betrag ist größer als der noch offene Teil des Umsatzes.");
    }

    let lines: PostingLine[];
    let description: string;
    let target: { invoiceId?: string; documentId?: string } = {};

    if (input.kind === "invoice") {
      const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, input.invoiceId)).for("update");
      if (!invoice || invoice.status !== "final") throw new BankError("Rechnung nicht zuordenbar.");
      const paidOn = async (invoiceId: string) => {
        const [paid] = await tx
          .select({ sum: sql<string>`coalesce(sum(amount), 0)` })
          .from(schema.allocations)
          .where(eq(schema.allocations.invoiceId, invoiceId));
        return Number(paid?.sum ?? 0);
      };
      let open: number;
      if (invoice.kind === "storno") {
        if (!invoice.correctsId) throw new BankError("Rechnung nicht zuordenbar.");
        open = stornoOpen(await paidOn(invoice.correctsId), await paidOn(invoice.id));
      } else {
        const [storno] = await tx
          .select({ id: schema.invoices.id })
          .from(schema.invoices)
          .where(and(eq(schema.invoices.correctsId, invoice.id), eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")));
        if (storno) throw new BankError(`Rechnung ${invoice.number} ist storniert; eine Erstattung gehört zur Stornorechnung.`);
        open = invoice.gross - (await paidOn(invoice.id));
      }
      if (Math.sign(open) !== Math.sign(input.amount) || Math.abs(input.amount) > Math.abs(open)) {
        throw new BankError(`Rechnung ${invoice.number} ist nur noch über ${open / 100} € offen.`);
      }
      const invoiceLines = await tx.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoice.id));
      const totals = computeInvoiceTotals(invoiceLines.map((l) => ({ ...l, taxRate: l.taxRate as 1900 | 700 | 0 })));
      lines = invoicePaymentPosting(totals, input.amount, company.kontenrahmen, company.versteuerung);
      description = `Zahlung ${invoice.number} · ${bank.counterpartyName}`;
      target = { invoiceId: invoice.id };
      // IBAN des Kunden für künftige Vorschläge merken
      if (invoice.contactId && bank.counterpartyIban) {
        await tx
          .update(schema.contacts)
          .set({ iban: bank.counterpartyIban })
          .where(and(eq(schema.contacts.id, invoice.contactId), eq(schema.contacts.iban, "")));
      }
    } else if (input.kind === "document") {
      const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, input.documentId));
      if (!doc || doc.status !== "gebucht") throw new BankError("Der Beleg muss erst gebucht sein.");
      if (doc.payment !== "bank") throw new BankError("Der Beleg ist als privat bezahlt gebucht.");
      const [paid] = await tx
        .select({ sum: sql<string>`coalesce(sum(amount), 0)` })
        .from(schema.allocations)
        .where(eq(schema.allocations.documentId, doc.id));
      const open = -doc.gross - Number(paid?.sum ?? 0);
      if (Math.sign(open) !== Math.sign(input.amount) || Math.abs(input.amount) > Math.abs(open)) {
        throw new BankError(`Der Beleg ist nur noch über ${Math.abs(open) / 100} € offen.`);
      }
      lines = documentPaymentPosting(input.amount, company.kontenrahmen);
      description = `Zahlung Beleg ${doc.invoiceNumber || doc.filename} · ${doc.supplierName}`;
      target = { documentId: doc.id };
    } else {
      lines = directPosting(input.kind as DirectBooking, input.amount, company.kontenrahmen);
      description = `${bank.counterpartyName || "Bankumsatz"} · ${input.kind}`;
    }

    const [allocation] = await tx
      .insert(schema.allocations)
      .values({ transactionId: bank.id, kind: input.kind, amount: input.amount, ...target })
      .returning();
    await postEntry(tx, { date: bank.bookingDate, description, sourceId: allocation!.id, lines });
  });
}

/** Hebt eine Zuordnung per Gegenzeile und Gegenbuchung auf. */
export async function reverseAllocation(actor: string, allocationId: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [allocation] = await tx.select().from(schema.allocations).where(eq(schema.allocations.id, allocationId)).for("update");
    if (!allocation || allocation.reversesId) throw new BankError("Zuordnung nicht gefunden.");
    const [already] = await tx.select({ id: schema.allocations.id }).from(schema.allocations).where(eq(schema.allocations.reversesId, allocationId));
    if (already) throw new BankError("Die Zuordnung ist bereits aufgehoben.");
    const [entry] = await tx
      .select()
      .from(schema.journalEntries)
      .where(and(eq(schema.journalEntries.sourceType, "allocation"), eq(schema.journalEntries.sourceId, allocationId), isNull(schema.journalEntries.reversesId)));
    const lines = entry
      ? await tx.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, entry.id))
      : [];
    const [reversal] = await tx
      .insert(schema.allocations)
      .values({
        transactionId: allocation.transactionId,
        kind: allocation.kind,
        invoiceId: allocation.invoiceId,
        documentId: allocation.documentId,
        amount: -allocation.amount,
        reversesId: allocation.id,
      })
      .returning();
    if (entry) {
      const [bank] = await tx.select({ bookingDate: schema.bankTransactions.bookingDate }).from(schema.bankTransactions).where(eq(schema.bankTransactions.id, allocation.transactionId));
      await postEntry(tx, {
        date: bank!.bookingDate,
        description: `Storno: ${entry.description}`,
        sourceId: reversal!.id,
        lines: reverseLines(lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, taxCode: l.taxCode as PostingLine["taxCode"] }))),
        reversesId: entry.id,
      });
    }
  });
}
