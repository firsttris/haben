import { randomUUID } from "node:crypto";
import { UserError } from "../../errors.ts";
import {
  ACCOUNTS,
  paymentProviderAccount,
  providerPattern,
  type Kontenrahmen,
  directPosting,
  documentOpen,
  documentWriteOffPosting,
  exchangeDifferenceBankPosting,
  exchangeDifferencePosting,
  invoiceWriteOffPosting,
  WRITE_OFF_KINDS,
  findPayoutGroup,
  findTransferCounterpart,
  payoutKey,
  suggestDirectBooking,
  documentPaymentPosting,
  invoiceOpen,
  invoicePaymentPosting,
  suggestMatches,
  type DirectBooking,
  type OpenItem,
  type OwnAccount,
  type PostingLine,
} from "@haben/core";
import { checkBalanceContinuity, parseStatement, PSP_FORMATS, StatementParseError, withDedupHashes, type ParsedStatement } from "@haben/import";
import { and, asc, desc, eq, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { invoiceTotalsById } from "../rechnungen/index.ts";
import { sha256Of } from "../../storage.ts";
import { today } from "../../today.ts";

export class BankError extends UserError {}

const normalizeIban = (iban: string) => iban.replace(/\s/g, "").toUpperCase();

const purposeSchema = z.enum(["geschaeft", "steuer", "ruecklage", "privat"]);

export const accountSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(100),
  purpose: purposeSchema.default("geschaeft"),
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
      // Zahlungsdienstleister nennen keinen Kontostand: Guthaben als Summe der importierten Umsätze
      const [sum] =
        account.purpose === "zahlungsdienstleister"
          ? await db.select({ total: sql<string>`coalesce(sum(${schema.bankTransactions.amount}), 0)` }).from(schema.bankTransactions).where(eq(schema.bankTransactions.bankAccountId, account.id))
          : [];
      // Beim Dienstleister bleibt nach zwei Wochen nichts offen, was zugeordnet werden kann; sonst fehlt eine Zuordnung
      const [stale] =
        account.purpose === "zahlungsdienstleister"
          ? await db
              .select({ n: sql<number>`count(*)::int` })
              .from(schema.bankTransactions)
              .where(and(eq(schema.bankTransactions.bankAccountId, account.id), sql`${openAmountSql} <> 0`, sql`${schema.bankTransactions.bookingDate} < ${today()}::date - 14`))
          : [];
      return { ...account, lastImport: last ?? null, openCount: open?.n ?? 0, providerBalance: sum ? Number(sum.total) : null, staleOpenCount: stale?.n ?? 0 };
    }),
  );
}

export async function createAccount(actor: string, input: z.input<typeof accountSchema>) {
  const data = accountSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [existing] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.iban, data.iban));
    if (existing) throw new BankError("Ein Konto mit dieser IBAN gibt es schon.");
    const [created] = await tx.insert(schema.bankAccounts).values(data).returning();
    return created!;
  });
}

/** Zweck nur bei Bankkonten; ein Zahlungsdienstleister bleibt einer */
export const accountSettingsSchema = z.object({ id: z.uuid(), name: accountSchema.shape.name, purpose: purposeSchema.optional() });

/**
 * Name und Zweck eines Kontos ändern. Beides ist nur Anzeige bzw. Vorschlag: Umsätze hängen an der ID,
 * der Import findet das Konto über die IBAN, Buchungen gehen weiter auf das eine Bankkonto.
 */
export async function updateAccount(actor: string, input: z.infer<typeof accountSettingsSchema>) {
  await withActor(actor, async (tx) => {
    const [account] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, input.id)).for("update");
    if (!account) throw new BankError("Konto nicht gefunden.");
    // Ein Zahlungsdienstleister bleibt einer (eigenes Verrechnungskonto, keine IBAN); dort ändert sich nur der Name
    const purpose = account.purpose === "zahlungsdienstleister" ? account.purpose : (input.purpose ?? account.purpose);
    await tx.update(schema.bankAccounts).set({ name: input.name, purpose }).where(eq(schema.bankAccounts.id, input.id));
  });
}

export const providerAccountSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(100),
  provider: z.enum(["paypal", "stripe", "shopify", "etsy", "sumup", "sonstige"]),
});

/**
 * Konto für einen Zahlungsdienstleister (PayPal-Guthaben, Stripe, Shopify Payments): ohne IBAN, mit eigenem
 * Verrechnungskonto (1361 … bzw. 1461 …). Importiert wird dessen CSV-Export in dieses Konto.
 */
export async function createProviderAccount(actor: string, input: z.input<typeof providerAccountSchema>) {
  const data = providerAccountSchema.parse(input);
  return withActor(actor, async (tx) => {
    // Sperre gegen zwei gleichzeitige Anlagen mit derselben Nummer; die Spalte ist zusätzlich eindeutig
    await tx.execute(sql`lock table bank_accounts in share row exclusive mode`);
    const used = new Set((await tx.select({ i: schema.bankAccounts.ledgerIndex }).from(schema.bankAccounts)).map((r) => r.i));
    const ledgerIndex = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((i) => !used.has(i));
    if (!ledgerIndex) throw new BankError("Es gibt schon neun Zahlungsdienstleister; mehr Verrechnungskonten sieht Haben nicht vor.");
    const [created] = await tx
      .insert(schema.bankAccounts)
      .values({ name: data.name, iban: null, purpose: "zahlungsdienstleister", provider: data.provider, ledgerIndex })
      .returning();
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
  return withActor(actor, (tx) => storeStatement(tx, statement, { filename: file.filename, sha256: sha256Of(file.bytes) }, accountId));
}

/**
 * Speichert einen Kontoauszug, egal ob aus einer Datei oder vom automatischen Abruf. Ohne `accountId`
 * wird das Konto über die IBAN gefunden oder angelegt.
 */
export async function storeStatement(
  tx: Tx,
  statement: ParsedStatement,
  source: { filename: string; sha256: string },
  accountId: string | null,
): Promise<ImportResult> {
  let account: typeof schema.bankAccounts.$inferSelect | undefined;
  const fileIban = statement.accountIban ? normalizeIban(statement.accountIban) : null;
  if (accountId) {
    [account] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, accountId));
    if (!account) throw new BankError("Konto nicht gefunden.");
    if (fileIban && fileIban !== account.iban) {
      throw new BankError(`Die Datei gehört zum Konto ${fileIban}, nicht zu ${account.name}.`);
    }
    // Export eines Zahlungsdienstleisters nur in dessen Konto, ein Kontoauszug nie dorthin
    const providerFile = PSP_FORMATS.includes(statement.format);
    if (providerFile !== (account.purpose === "zahlungsdienstleister")) {
      throw new BankError(
        providerFile
          ? `${source.filename}: Das ist der Export eines Zahlungsdienstleisters. Bitte unter „Konto“ das Konto des Dienstleisters wählen.`
          : `${source.filename}: ${account.name} ist ein Zahlungsdienstleister; dorthin gehört nur dessen Export.`,
      );
    }
  } else if (fileIban) {
    account = await accountForIban(tx, fileIban, statement.accountName);
  } else if (PSP_FORMATS.includes(statement.format)) {
    throw new BankError(`${source.filename}: Export eines Zahlungsdienstleisters. Bitte unter „Konto“ das Konto des Dienstleisters wählen.`);
  } else {
    throw new BankError(`${source.filename}: Die Datei nennt keine IBAN. Bitte das Konto auswählen.`);
  }

  const [previous] = await tx
    .select({ closingBalance: schema.bankImports.closingBalance, periodTo: schema.bankImports.periodTo })
    .from(schema.bankImports)
    .where(
      and(
        eq(schema.bankImports.bankAccountId, account.id),
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
  await tx.select({ id: schema.bankAccounts.id }).from(schema.bankAccounts).where(eq(schema.bankAccounts.id, account.id)).for("update");
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
                eq(schema.bankTransactions.bankAccountId, account.id),
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
      bankAccountId: account.id,
      filename: source.filename.slice(0, 200),
      sha256: source.sha256,
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
        bankAccountId: account.id,
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
    accountId: account.id,
    accountName: account.name,
    added,
    skipped: transactions.length - added,
    warnings: statement.warnings,
    gap: continuity.ok ? null : (continuity.message ?? "Lücke zum vorigen Import"),
  };
}

/** Konto zur IBAN; fehlt es, wird es angelegt */
export async function accountForIban(tx: Tx, iban: string, name?: string) {
  const normalized = normalizeIban(iban);
  const [existing] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.iban, normalized));
  if (existing) return existing;
  const [created] = await tx
    .insert(schema.bankAccounts)
    .values({ iban: normalized, name: name || `Konto …${normalized.slice(-4)}` })
    .returning();
  return created!;
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

/**
 * Erledigter Betrag je Rechnung bzw. Beleg: Zuordnungen und Ausbuchungen (Skonto, Forderungsausfall), Vorzeichen
 * wie auf dem Konto. Ausbuchungen bewegen kein Geld, zählen für „offen“ aber wie eine Zahlung.
 */
async function paidByTarget(column: "invoice_id" | "document_id", ids: string[], q: Db | Tx = db): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const col = sql.raw(column);
  const rows = await q.execute<{ id: string; paid: string }>(
    sql`select id, sum(amount) as paid from (
          select ${col} as id, amount from allocations where ${col} in ${ids}
          union all select ${col} as id, amount from write_offs where ${col} in ${ids}
        ) settled group by 1`,
  );
  return new Map([...rows].map((r) => [r.id, Number(r.paid)]));
}

/** Erledigter Betrag einer Rechnung bzw. eines Belegs innerhalb einer Transaktion (nach dem Sperren) */
async function settledOn(tx: Tx, column: "invoice_id" | "document_id", id: string): Promise<number> {
  return (await paidByTarget(column, [id], tx)).get(id) ?? 0;
}

export async function invoicePayments(ids: string[], q: Db | Tx = db) {
  return paidByTarget("invoice_id", ids, q);
}

/** Ausgebuchte Beträge je Rechnung (Skonto und Forderungsausfall, Gegenzeilen abgezogen) */
export async function invoiceWrittenOff(ids: string[], q: Db | Tx = db): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await q
    .select({ id: schema.writeOffs.invoiceId, sum: sql<string>`sum(${schema.writeOffs.amount})` })
    .from(schema.writeOffs)
    .where(inArray(schema.writeOffs.invoiceId, ids))
    .groupBy(schema.writeOffs.invoiceId);
  return new Map(rows.filter((r) => Number(r.sum) !== 0).map((r) => [r.id!, Number(r.sum)]));
}

/** Als Forderungsausfall ausgebuchte Beträge je Rechnung (Gegenzeilen abgezogen) */
export async function invoiceLosses(ids: string[], q: Db | Tx = db): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await q
    .select({ id: schema.writeOffs.invoiceId, sum: sql<string>`sum(${schema.writeOffs.amount})` })
    .from(schema.writeOffs)
    .where(and(inArray(schema.writeOffs.invoiceId, ids), eq(schema.writeOffs.kind, "forderungsausfall")))
    .groupBy(schema.writeOffs.invoiceId);
  return new Map(rows.map((r) => [r.id!, Number(r.sum)]));
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
      currency: schema.invoices.currency,
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
    .select({
      id: schema.documents.id,
      invoiceNumber: schema.documents.invoiceNumber,
      documentDate: schema.documents.documentDate,
      uploadedAt: schema.documents.uploadedAt,
      dueDate: schema.documents.dueDate,
      gross: schema.documents.gross,
      currency: schema.documents.currency,
      supplierName: schema.documents.supplierName,
    })
    .from(schema.documents)
    .where(and(eq(schema.documents.status, "gebucht"), eq(schema.documents.payment, "bank")));
  const documentPaid = await paidByTarget("document_id", documents.map((d) => d.id));

  const items: OpenItem[] = [];
  for (const inv of invoices) {
    const open = invoiceOpen({ status: "final", kind: inv.kind, gross: inv.gross, paid: invoicePaid.get(inv.id) ?? 0, cancelled: cancelled.has(inv.id) });
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
      currency: inv.currency,
    });
  }
  // Storno einer schon bezahlten Rechnung: die Erstattung wird der Stornorechnung zugeordnet
  for (const storno of stornos) {
    const open = invoiceOpen({
      status: "final",
      kind: "storno",
      gross: 0,
      paid: invoicePaid.get(storno.id) ?? 0,
      paidOnOriginal: invoicePaid.get(storno.correctsId!) ?? 0,
      cancelled: false,
    });
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
    const open = documentOpen(doc.gross, documentPaid.get(doc.id) ?? 0);
    if (open === 0) continue;
    items.push({
      type: "document",
      id: doc.id,
      number: doc.invoiceNumber,
      date: doc.documentDate ?? today(doc.uploadedAt),
      dueDate: doc.dueDate,
      open,
      partyName: doc.supplierName,
      partyIbans: [],
      currency: doc.currency,
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
      bankReference: schema.bankTransactions.bankReference,
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
      splitId: schema.allocations.splitId,
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
    // Teile einer Aufteilung haben denselben Zeitstempel (eine Transaktion): Erlös vor Gebühr, damit die Reihenfolge feststeht
    .orderBy(asc(schema.allocations.createdAt), desc(schema.allocations.amount), asc(schema.allocations.id));
  const reversed = new Set(allocationRows.filter((a) => a.reversesId).map((a) => a.reversesId));
  const allocations = allocationRows
    .filter((a) => !a.reversesId)
    .map((a) => ({ ...a, reversed: reversed.has(a.id) }));

  const items = tx.open === 0 ? [] : await openItems();
  // Vorschläge für den noch offenen Teil des Umsatzes
  const suggestions = tx.open === 0 ? [] : suggestMatches({ ...tx, amount: tx.open }, items);
  const candidates = items.filter((i) => Math.sign(i.open) === Math.sign(tx.amount));
  // Ohne Rechnung: Vorschlag aus dem Zweck der Konten, bei Geldtransit mit der Gegenbuchung auf dem anderen Konto
  const accounts = await ownAccounts();
  const account = accounts.find((a) => a.id === tx.bankAccountId);
  let direct = account && tx.open === tx.amount ? suggestDirectBooking(tx, account, accounts) : null;
  let counterpart: TransferCounterpart | null = null;
  if (direct?.kind === "geldtransit" && account) {
    // Auszahlung vom Dienstleister: Gegenbuchung auf einem Bankkonto, dort mit dem Namen des Dienstleisters
    const targets = direct.counterAccountId ? [direct.counterAccountId] : accounts.filter((a) => a.purpose !== "zahlungsdienstleister").map((a) => a.id);
    const key = account.purpose === "zahlungsdienstleister" ? payoutKey(tx.bankReference) : null;
    if (key) {
      // Teil einer Auszahlung (Shopify): die Bank zeigt die Summe aller Teile mit derselben Auszahlungs-ID
      const parts = (await payoutCandidates([account.id], tx.bookingDate)).filter((p) => payoutKey(p.bankReference) === key);
      const total = parts.reduce((s, p) => s + p.amount, 0);
      const bank = parts.every((p) => p.open === p.amount) ? await transferCounterpart({ ...tx, amount: total }, null, targets, providerPattern(account)) : null;
      counterpart = bank ? { ...bank, payoutIds: parts.filter((p) => p.id !== tx.id).map((p) => p.id) } : null;
    } else {
      counterpart = await transferCounterpart(tx, account.iban, targets, providerPattern(account));
      if (!counterpart && direct.counterAccountId && account.purpose !== "zahlungsdienstleister") {
        // Eingang auf der Bank aus mehreren Teilen einer Auszahlung im Konto des Dienstleisters
        const group = findPayoutGroup(tx, await payoutCandidates([direct.counterAccountId], tx.bookingDate));
        if (group) {
          const [first, ...rest] = group;
          counterpart = { id: first!.id, bookingDate: first!.bookingDate, amount: -tx.amount, counterpartyName: first!.counterpartyName, payoutIds: rest.map((r) => r.id) };
        }
      }
    }
  }
  if (direct?.requiresCounterpart && !counterpart) direct = null;
  // Für die Aufteilung auch Posten in Gegenrichtung, etwa der Gebührenbeleg in einer Auszahlung
  return { transaction: tx, allocations, suggestions, candidates, splitCandidates: items, direct: direct ? { ...direct, counterpart } : null };
}

/** Schon gezahlte Umsatzsteuer (Zuordnungen „Umsatzsteuer an das Finanzamt“, positiv) mit Buchungsdatum nach `after` */
export async function vatPaidAfter(after: string): Promise<number> {
  const [row] = await db
    .select({ paid: sql<string>`coalesce(-sum(${schema.allocations.amount}), 0)` })
    .from(schema.allocations)
    .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.allocations.transactionId))
    .where(and(eq(schema.allocations.kind, "ustVorauszahlung"), sql`${schema.bankTransactions.bookingDate} > ${after}`));
  return Number(row?.paid ?? 0);
}

/** Alle eigenen Konten mit Zweck, für Vorschläge ohne Rechnung */
export async function ownAccounts(): Promise<OwnAccount[]> {
  return db
    .select({
      id: schema.bankAccounts.id,
      name: schema.bankAccounts.name,
      iban: schema.bankAccounts.iban,
      purpose: schema.bankAccounts.purpose,
      provider: schema.bankAccounts.provider,
    })
    .from(schema.bankAccounts);
}

/**
 * Ganz offene Gegenbuchung eines Geldtransits auf einem der anderen Konten (± 5 Tage, gleicher Betrag), deren Gegenkonto
 * das Ausgangskonto ist (sourceIban) bzw. deren Gegenpartei der Dienstleister ist (pattern)
 */
async function transferCounterpart(
  tx: { id: string; bookingDate: string; amount: number },
  sourceIban: string | null,
  accountIds: string[],
  pattern: RegExp | null,
) {
  if (accountIds.length === 0) return null;
  const rows = await db
    .select({
      id: schema.bankTransactions.id,
      bookingDate: schema.bankTransactions.bookingDate,
      amount: schema.bankTransactions.amount,
      counterpartyName: schema.bankTransactions.counterpartyName,
      counterpartyIban: schema.bankTransactions.counterpartyIban,
      open: openAmountSql.mapWith(Number),
    })
    .from(schema.bankTransactions)
    .where(
      and(
        inArray(schema.bankTransactions.bankAccountId, accountIds),
        eq(schema.bankTransactions.amount, -tx.amount),
        sql`${schema.bankTransactions.bookingDate} between ${tx.bookingDate}::date - 5 and ${tx.bookingDate}::date + 5`,
      ),
    );
  const match = findTransferCounterpart(tx, sourceIban, rows, pattern);
  return match ? { id: match.id, bookingDate: match.bookingDate, amount: match.amount, counterpartyName: match.counterpartyName } : null;
}

type TransferCounterpart = { id: string; bookingDate: string; amount: number; counterpartyName: string; payoutIds?: string[] };

/** Teile von Auszahlungen (Referenz „payout-…|“) in den Konten der Dienstleister, ± 10 Tage um den Eingang */
async function payoutCandidates(accountIds: string[], bookingDate: string) {
  return db
    .select({
      id: schema.bankTransactions.id,
      bookingDate: schema.bankTransactions.bookingDate,
      amount: schema.bankTransactions.amount,
      counterpartyName: schema.bankTransactions.counterpartyName,
      bankReference: schema.bankTransactions.bankReference,
      open: openAmountSql.mapWith(Number),
    })
    .from(schema.bankTransactions)
    .where(
      and(
        inArray(schema.bankTransactions.bankAccountId, accountIds),
        sql`${schema.bankTransactions.bankReference} like 'payout-%|%'`,
        sql`${schema.bankTransactions.bookingDate} between ${bookingDate}::date - 10 and ${bookingDate}::date + 10`,
      ),
    );
}

export const transferSchema = z.object({
  transactionId: z.uuid(),
  counterpartId: z.uuid(),
  /** Weitere Teile derselben Auszahlung im Konto des Dienstleisters (Shopify Payments: ein Teil je Transaktion) */
  payoutIds: z.array(z.uuid()).max(1000).optional(),
});

/**
 * Geldtransit zwischen zwei eigenen Konten: beide Umsätze (gleicher Betrag, umgekehrtes Vorzeichen) in einem
 * Schritt über das Geldtransitkonto buchen. Auf dem Geldtransitkonto heben sich beide Seiten auf.
 */
export async function allocateTransfer(actor: string, input: z.infer<typeof transferSchema>): Promise<void> {
  await withActor(actor, async (tx) => {
    const company = await openBooks(tx);
    // Feste Reihenfolge beim Sperren, damit zwei gleichzeitige Aufrufe sich nicht gegenseitig blockieren
    const ids = [...new Set([input.transactionId, input.counterpartId, ...(input.payoutIds ?? [])])].sort();
    const rows = await tx
      .select({
        id: schema.bankTransactions.id,
        bankAccountId: schema.bankTransactions.bankAccountId,
        amount: schema.bankTransactions.amount,
        bookingDate: schema.bankTransactions.bookingDate,
        counterpartyName: schema.bankTransactions.counterpartyName,
        counterpartyIban: schema.bankTransactions.counterpartyIban,
        bankReference: schema.bankTransactions.bankReference,
        accountIban: schema.bankAccounts.iban,
        provider: schema.bankAccounts.provider,
        ledgerIndex: schema.bankAccounts.ledgerIndex,
        open: openAmountSql.mapWith(Number),
      })
      .from(schema.bankTransactions)
      .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.bankTransactions.bankAccountId))
      .where(inArray(schema.bankTransactions.id, ids))
      .orderBy(asc(schema.bankTransactions.id))
      .for("update");
    if (rows.length !== ids.length) throw new BankError("Umsatz nicht gefunden.");
    if (rows.some((r) => r.open !== r.amount)) throw new BankError("Beide Umsätze müssen noch ganz offen sein.");
    // Zwei Seiten: der gewählte Umsatz und die Gegenbuchung; mehrere Umsätze nur als Teile einer Auszahlung
    const sides = [...new Set(rows.map((r) => r.bankAccountId))].map((account) => rows.filter((r) => r.bankAccountId === account));
    if (sides.length !== 2) throw new BankError("Ein Geldtransit verbindet zwei verschiedene Konten.");
    if (rows.reduce((s, r) => s + r.amount, 0) !== 0) throw new BankError("Die beiden Umsätze haben nicht denselben Betrag mit umgekehrtem Vorzeichen.");
    const parts = sides.find((side) => side.length > 1);
    if (parts) {
      const key = payoutKey(parts[0]!.bankReference);
      if (!parts[0]!.provider || !key || parts.some((p) => payoutKey(p.bankReference) !== key) || sides.some((side) => side !== parts && side.length > 1)) {
        throw new BankError("Mehrere Umsätze lassen sich nur als Teile derselben Auszahlung eines Zahlungsdienstleisters verbinden.");
      }
    }
    const [first, second] = sides.map((side) => side[0]!);
    if (!first || !second) throw new BankError("Umsatz nicht gefunden.");
    const provider = [first, second].find((r) => r.provider);
    if (provider) {
      // Zahlungsdienstleister ohne IBAN: die Bankseite muss ihn als Gegenpartei nennen (Auszahlung von PayPal)
      const bankSide = provider === first ? second : first;
      const pattern = providerPattern(provider);
      if (bankSide.provider || !pattern || !pattern.test(bankSide.counterpartyName)) {
        throw new BankError("Auf dem Bankkonto ist nicht der Zahlungsdienstleister die Gegenpartei.");
      }
    } else {
      // Nennt eine Seite ein Gegenkonto, muss es das andere eigene Konto sein, und mindestens eine muss es nennen;
      // sonst ist es eine fremde Zahlung über denselben Betrag (Erstattung, Kunde)
      const pointsTo = (a: typeof first, b: typeof first) => a.counterpartyIban === b.accountIban;
      const named = [first, second].filter((r) => r.counterpartyIban);
      if (named.length === 0 || (first.counterpartyIban && !pointsTo(first, second)) || (second.counterpartyIban && !pointsTo(second, first))) {
        throw new BankError("Die beiden Umsätze nennen nicht das jeweils andere Konto als Gegenkonto.");
      }
    }
    for (const bank of rows) {
      const [allocation] = await tx.insert(schema.allocations).values({ transactionId: bank.id, kind: "geldtransit", amount: bank.amount }).returning();
      await post(tx, company, {
        date: bank.bookingDate,
        description: `${bank.counterpartyName || "Bankumsatz"} · geldtransit`,
        sourceType: "allocation",
        sourceId: allocation!.id,
        lines: onLedger(directPosting("geldtransit", bank.amount, company.kontenrahmen), company.kontenrahmen, bank.ledgerIndex),
      });
    }
  });
}

/**
 * Buchungszeilen eines Umsatzes auf das richtige Geldkonto: Bank (1200/1800) bzw. beim Zahlungsdienstleister dessen
 * Verrechnungskonto (1361 … bzw. 1461 …). Die Buchungsfunktionen in @haben/core buchen immer auf die Bank.
 */
function onLedger(lines: PostingLine[], kontenrahmen: Kontenrahmen, ledgerIndex: number | null): PostingLine[] {
  if (ledgerIndex === null) return lines;
  const bank = ACCOUNTS[kontenrahmen].bank;
  const ledger = paymentProviderAccount(kontenrahmen, ledgerIndex);
  return lines.map((l) => (l.account === bank ? { ...l, account: ledger } : l));
}

function reverseLines(lines: PostingLine[]): PostingLine[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}

const DIRECT_KINDS = ["privat", "geldtransit", "ustVorauszahlung", "gebuehren", "mahnerloes"] as const;

export const allocationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("invoice"), transactionId: z.uuid(), invoiceId: z.uuid(), amount: z.number().int() }),
  z.object({ kind: z.literal("document"), transactionId: z.uuid(), documentId: z.uuid(), amount: z.number().int() }),
  z.object({
    kind: z.enum(DIRECT_KINDS),
    transactionId: z.uuid(),
    amount: z.number().int(),
  }),
]);

export type AllocationInput = z.infer<typeof allocationSchema>;

/** Ein Teil einer Aufteilung: Ziel und Betrag, Vorzeichen wie auf dem Konto (Gebühr in einer Auszahlung also negativ) */
const splitPartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("invoice"), invoiceId: z.uuid(), amount: z.number().int() }),
  z.object({ kind: z.literal("document"), documentId: z.uuid(), amount: z.number().int() }),
  z.object({ kind: z.enum(DIRECT_KINDS), amount: z.number().int() }),
]);

export const splitSchema = z.object({ transactionId: z.uuid(), parts: z.array(splitPartSchema).min(2).max(20) });

export type SplitInput = z.infer<typeof splitSchema>;
/** Dazu intern: der Teil einer Zahlung über dem offenen Betrag einer Fremdwährungsrechnung (allocateWithRest) */
type Part = z.infer<typeof splitPartSchema> | { kind: "kursdifferenz"; amount: number };

/** Sperrt den Umsatz für die Dauer der Zuordnung: Zwei gleichzeitige Zuordnungen sähen sonst denselben offenen Teil */
async function lockTransaction(tx: Tx, id: string) {
  const [bank] = await tx
    .select({
      id: schema.bankTransactions.id,
      amount: schema.bankTransactions.amount,
      bookingDate: schema.bankTransactions.bookingDate,
      counterpartyName: schema.bankTransactions.counterpartyName,
      counterpartyIban: schema.bankTransactions.counterpartyIban,
      ledgerIndex: schema.bankAccounts.ledgerIndex,
      open: openAmountSql.mapWith(Number),
    })
    .from(schema.bankTransactions)
    .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.bankTransactions.bankAccountId))
    .where(eq(schema.bankTransactions.id, id))
    .for("update", { of: schema.bankTransactions });
  if (!bank) throw new BankError("Umsatz nicht gefunden.");
  return bank;
}

type LockedTransaction = Awaited<ReturnType<typeof lockTransaction>>;

/**
 * Bucht einen Teil eines Umsatzes auf Rechnung, Beleg oder eine Buchung ohne Beleg. Der Betrag trägt das Vorzeichen,
 * mit dem er das Konto bewegt; geprüft wird hier nur gegen das Ziel (offener Betrag der Rechnung bzw. des Belegs).
 */
async function bookPart(tx: Tx, company: Awaited<ReturnType<typeof openBooks>>, bank: LockedTransaction, part: Part, splitId: string | null) {
  let lines: PostingLine[];
  let description: string;
  let target: { invoiceId?: string; documentId?: string } = {};

  if (part.kind === "invoice") {
    const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, part.invoiceId)).for("update");
    if (!invoice || invoice.status !== "final") throw new BankError("Rechnung nicht zuordenbar.");
    const paidOn = (invoiceId: string) => settledOn(tx, "invoice_id", invoiceId);
    let open: number;
    if (invoice.kind === "storno") {
      if (!invoice.correctsId) throw new BankError("Rechnung nicht zuordenbar.");
      open = invoiceOpen({ ...invoice, paid: await paidOn(invoice.id), paidOnOriginal: await paidOn(invoice.correctsId), cancelled: false });
    } else {
      const [storno] = await tx
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(and(eq(schema.invoices.correctsId, invoice.id), eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")));
      if (storno) throw new BankError(`Rechnung ${invoice.number} ist storniert; eine Erstattung gehört zur Stornorechnung.`);
      open = invoiceOpen({ ...invoice, paid: await paidOn(invoice.id), cancelled: false });
    }
    if (Math.sign(open) !== Math.sign(part.amount) || Math.abs(part.amount) > Math.abs(open)) {
      throw new BankError(`Rechnung ${invoice.number} ist nur noch über ${open / 100} € offen.`);
    }
    const totals = (await invoiceTotalsById([invoice.id], tx)).get(invoice.id)!;
    lines = invoicePaymentPosting(totals, part.amount, company.kontenrahmen, company.versteuerung);
    description = `Zahlung ${invoice.number} · ${bank.counterpartyName}`;
    target = { invoiceId: invoice.id };
    // IBAN des Kunden für künftige Vorschläge merken
    if (invoice.contactId && bank.counterpartyIban) {
      await tx
        .update(schema.contacts)
        .set({ iban: bank.counterpartyIban })
        .where(and(eq(schema.contacts.id, invoice.contactId), eq(schema.contacts.iban, "")));
    }
  } else if (part.kind === "document") {
    // Sperre wie bei der Rechnung: Zwei gleichzeitige Zuordnungen könnten den Beleg sonst überzahlen
    const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, part.documentId)).for("update");
    if (!doc || doc.status !== "gebucht") throw new BankError("Der Beleg muss erst gebucht sein.");
    if (doc.payment !== "bank") throw new BankError("Der Beleg ist als privat bezahlt gebucht.");
    const open = documentOpen(doc.gross, await settledOn(tx, "document_id", doc.id));
    if (Math.sign(open) !== Math.sign(part.amount) || Math.abs(part.amount) > Math.abs(open)) {
      throw new BankError(`Der Beleg ist nur noch über ${Math.abs(open) / 100} € offen.`);
    }
    lines = documentPaymentPosting(part.amount, company.kontenrahmen);
    description = `Zahlung Beleg ${doc.invoiceNumber || doc.filename} · ${doc.supplierName}`;
    target = { documentId: doc.id };
  } else if (part.kind === "kursdifferenz") {
    lines = exchangeDifferenceBankPosting(part.amount, company.kontenrahmen);
    description = `Kursdifferenz · ${bank.counterpartyName || "Bankumsatz"}`;
  } else {
    lines = directPosting(part.kind as DirectBooking, part.amount, company.kontenrahmen);
    description = `${bank.counterpartyName || "Bankumsatz"} · ${part.kind}`;
  }

  const [allocation] = await tx
    .insert(schema.allocations)
    .values({ transactionId: bank.id, kind: part.kind, amount: part.amount, splitId, ...target })
    .returning();
  await post(tx, company, { date: bank.bookingDate, description, sourceType: "allocation", sourceId: allocation!.id, lines: onLedger(lines, company.kontenrahmen, bank.ledgerIndex) });
}

/** Ordnet (einen Teil) eines Umsatzes zu und bucht die Zahlung. */
export async function allocate(actor: string, input: AllocationInput): Promise<void> {
  await withActor(actor, async (tx) => {
    const company = await openBooks(tx);
    const bank = await lockTransaction(tx, input.transactionId);
    if (input.amount === 0 || Math.sign(input.amount) !== Math.sign(bank.amount)) {
      throw new BankError("Der Betrag muss das Vorzeichen des Umsatzes haben.");
    }
    if (Math.abs(input.amount) > Math.abs(bank.open)) {
      throw new BankError("Der Betrag ist größer als der noch offene Teil des Umsatzes.");
    }
    const { transactionId: _transactionId, ...part } = input;
    await bookPart(tx, company, bank, part, null);
  });
}

/**
 * Splitbuchung: teilt den offenen Teil eines Umsatzes in mehrere Teile mit eigenem Ziel, z. B. eine Auszahlung von
 * 90,00 € in „Rechnung +100,00 €“ und „Gebühr −10,00 €“. Die Teile dürfen unterschiedliche Vorzeichen haben,
 * müssen zusammen aber genau den offenen Teil ergeben. Jeder Teil wird einzeln gebucht (Bruttoprinzip: voller Erlös,
 * Gebühr als Aufwand), alles in einer Transaktion; aufgehoben wird nur die ganze Aufteilung.
 */
export async function allocateSplit(actor: string, input: SplitInput): Promise<void> {
  await withActor(actor, async (tx) => {
    const company = await openBooks(tx);
    const bank = await lockTransaction(tx, input.transactionId);
    // Ohne offenen Betrag ergäben beliebige Teile mit Summe 0 eine erfundene Zahlung (Rechnung +x, Privat −x)
    if (bank.open === 0) throw new BankError("Der Umsatz ist schon ganz zugeordnet.");
    if (input.parts.some((p) => p.amount === 0)) throw new BankError("Jeder Teil braucht einen Betrag.");
    const sum = input.parts.reduce((s, p) => s + p.amount, 0);
    if (sum !== bank.open) {
      throw new BankError(`Die Teile ergeben ${sum / 100} €, offen sind ${bank.open / 100} €. Sie müssen genau den offenen Betrag ergeben.`);
    }
    const splitId = randomUUID();
    for (const part of input.parts) await bookPart(tx, company, bank, part, splitId);
  });
}

/** Hebt eine Zuordnung per Gegenzeile und Gegenbuchung auf; Teile einer Aufteilung nur alle zusammen. */
export async function reverseAllocation(actor: string, allocationId: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [allocation] = await tx.select().from(schema.allocations).where(eq(schema.allocations.id, allocationId)).for("update");
    if (!allocation || allocation.reversesId) throw new BankError("Zuordnung nicht gefunden.");
    const [already] = await tx.select({ id: schema.allocations.id }).from(schema.allocations).where(eq(schema.allocations.reversesId, allocationId));
    if (already) throw new BankError("Die Zuordnung ist bereits aufgehoben.");
    // Einzelne Teile einer Aufteilung ergäben allein nicht mehr den Umsatz (die Gebühr bliebe ohne den Erlös stehen)
    const parts = allocation.splitId
      ? await tx
          .select()
          .from(schema.allocations)
          .where(and(eq(schema.allocations.splitId, allocation.splitId), isNull(schema.allocations.reversesId)))
          .orderBy(asc(schema.allocations.createdAt))
          .for("update")
      : [allocation];
    for (const part of parts) await reverseOne(tx, part);
    // Mit der Zahlung ausgebuchter Rest (Skonto): ohne die Zahlung wäre er falsch, also mit aufheben
    const targets = parts.flatMap((p) => [p.invoiceId, p.documentId]).filter((id): id is string => id !== null);
    if (targets.length > 0) {
      const linked = await tx
        .select()
        .from(schema.writeOffs)
        .where(
          and(
            eq(schema.writeOffs.transactionId, allocation.transactionId),
            isNull(schema.writeOffs.reversesId),
            or(inArray(schema.writeOffs.invoiceId, targets), inArray(schema.writeOffs.documentId, targets)),
          ),
        )
        .for("update");
      for (const writeOff of linked) await reverseWriteOffRow(tx, writeOff);
    }
  });
}

async function reverseOne(tx: Tx, allocation: typeof schema.allocations.$inferSelect) {
  const [already] = await tx.select({ id: schema.allocations.id }).from(schema.allocations).where(eq(schema.allocations.reversesId, allocation.id));
  if (already) return;
  const [entry] = await tx
    .select()
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "allocation"), eq(schema.journalEntries.sourceId, allocation.id), isNull(schema.journalEntries.reversesId)));
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
      splitId: allocation.splitId,
      reversesId: allocation.id,
    })
    .returning();
  if (entry) {
    const [bank] = await tx.select({ bookingDate: schema.bankTransactions.bookingDate }).from(schema.bankTransactions).where(eq(schema.bankTransactions.id, allocation.transactionId));
    // Gegenbuchung im Kontenrahmen der Firmendaten; wechseln kann er nur, solange im Jahr nichts gebucht ist
    await post(tx, await openBooks(tx), {
      date: bank!.bookingDate,
      description: `Storno: ${entry.description}`,
      sourceType: "allocation",
      sourceId: reversal!.id,
      lines: reverseLines(lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, taxCode: l.taxCode as PostingLine["taxCode"] }))),
      reversesId: entry.id,
    });
  }
}

export const feesSchema = z.object({ transactionId: z.uuid(), documentId: z.uuid() });

/**
 * Gebühren eines Zahlungsdienstleisters gegen seine Sammelrechnung: ordnet alle noch offenen Gebühren (Umsätze „Gebühr …“)
 * desselben Kontos aus dem Monat des gewählten Umsatzes dem Beleg zu, wie Teilzahlungen, bis der Beleg erledigt ist.
 * Vorsteuer bzw. § 13b laufen dann einmal über den Beleg. Gibt die Zahl der zugeordneten Gebühren zurück.
 */
export async function allocateFeesToDocument(actor: string, input: z.infer<typeof feesSchema>): Promise<number> {
  return withActor(actor, async (tx) => {
    const company = await openBooks(tx);
    const [chosen] = await tx
      .select({ bankAccountId: schema.bankTransactions.bankAccountId, bookingDate: schema.bankTransactions.bookingDate, purpose: schema.bankAccounts.purpose })
      .from(schema.bankTransactions)
      .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.bankTransactions.bankAccountId))
      .where(eq(schema.bankTransactions.id, input.transactionId));
    if (!chosen) throw new BankError("Umsatz nicht gefunden.");
    if (chosen.purpose !== "zahlungsdienstleister") throw new BankError("Sammelrechnungen gibt es nur für Gebühren eines Zahlungsdienstleisters.");
    const month = chosen.bookingDate.slice(0, 7);
    const fees = await tx
      .select({ id: schema.bankTransactions.id })
      .from(schema.bankTransactions)
      .where(
        and(
          eq(schema.bankTransactions.bankAccountId, chosen.bankAccountId),
          sql`to_char(${schema.bankTransactions.bookingDate}, 'YYYY-MM') = ${month}`,
          sql`${schema.bankTransactions.purpose} like 'Gebühr%'`,
          sql`${schema.bankTransactions.amount} < 0`,
          sql`${openAmountSql} <> 0`,
        ),
      )
      .orderBy(asc(schema.bankTransactions.bookingDate), asc(schema.bankTransactions.id));
    let count = 0;
    for (const fee of fees) {
      const bank = await lockTransaction(tx, fee.id);
      const [doc] = await tx.select({ gross: schema.documents.gross }).from(schema.documents).where(eq(schema.documents.id, input.documentId));
      if (!doc) throw new BankError("Beleg nicht gefunden.");
      const open = documentOpen(doc.gross, await settledOn(tx, "document_id", input.documentId));
      if (open === 0 || Math.sign(open) !== Math.sign(bank.open)) break;
      const amount = Math.abs(bank.open) <= Math.abs(open) ? bank.open : open;
      await bookPart(tx, company, bank, { kind: "document", documentId: input.documentId, amount }, null);
      count++;
    }
    if (count === 0) throw new BankError("Keine offene Gebühr in diesem Monat, oder der Beleg ist schon erledigt.");
    return count;
  });
}

// Ausbuchungen ----------------------------------------------------------------------------------------------

export const writeOffSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["skonto", "forderungsausfall"]), invoiceId: z.uuid(), date: z.iso.date(), amount: z.number().int().optional() }),
  z.object({ kind: z.literal("skontoErhalten"), documentId: z.uuid(), date: z.iso.date(), amount: z.number().int().optional() }),
]);

export type WriteOffInput = z.infer<typeof writeOffSchema>;

/**
 * Bucht den Rest einer Rechnung bzw. eines Belegs aus (ohne amount: den ganzen offenen Betrag). Prüft den offenen
 * Betrag wie eine Zuordnung, bucht Erlösschmälerung bzw. Forderungsverlust oder erhaltenes Skonto samt Korrektur der
 * Umsatzsteuer bzw. Vorsteuer (§ 17 UStG) und gibt den ausgebuchten Betrag zurück.
 */
/** Kursdifferenz: nur zusammen mit einer Zahlung (allocateWithRest), auf eine Rechnung oder einen Beleg in Fremdwährung */
type ExchangeDifferenceInput = { kind: "kursdifferenz"; date: string; transactionId: string } & ({ invoiceId: string } | { documentId: string });

async function bookWriteOff(
  tx: Tx,
  company: Awaited<ReturnType<typeof openBooks>>,
  input: (WriteOffInput & { transactionId?: string }) | ExchangeDifferenceInput,
): Promise<number> {
  let amount: number;
  let lines: PostingLine[];
  let description: string;
  let target: { invoiceId: string | null; documentId: string | null };
  if (input.kind === "kursdifferenz") {
    if ("invoiceId" in input) {
      const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, input.invoiceId)).for("update");
      if (!invoice || invoice.status !== "final") throw new BankError("Rechnung nicht gefunden.");
      if (invoice.currency === "EUR") throw new BankError("Eine Kursdifferenz gibt es nur bei Rechnungen in Fremdwährung.");
      amount = invoiceOpen({ ...invoice, paid: await settledOn(tx, "invoice_id", invoice.id), cancelled: false });
      const totals = (await invoiceTotalsById([invoice.id], tx)).get(invoice.id)!;
      lines = exchangeDifferencePosting({ kind: "invoice", totals, versteuerung: company.versteuerung }, amount, company.kontenrahmen);
      description = `Kursdifferenz · Rechnung ${invoice.number}`;
      target = { invoiceId: invoice.id, documentId: null };
    } else {
      const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, input.documentId)).for("update");
      if (!doc || doc.status !== "gebucht") throw new BankError("Der Beleg muss erst gebucht sein.");
      if (doc.currency === "EUR") throw new BankError("Eine Kursdifferenz gibt es nur bei Belegen in Fremdwährung.");
      amount = documentOpen(doc.gross, await settledOn(tx, "document_id", doc.id));
      lines = exchangeDifferencePosting({ kind: "document" }, amount, company.kontenrahmen);
      description = `Kursdifferenz · Beleg ${doc.invoiceNumber || doc.filename} · ${doc.supplierName}`;
      target = { invoiceId: null, documentId: doc.id };
    }
    if (amount === 0) return 0;
  } else if (input.kind === "skontoErhalten") {
    const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, input.documentId)).for("update");
    if (!doc || doc.status !== "gebucht") throw new BankError("Der Beleg muss erst gebucht sein.");
    if (doc.payment !== "bank") throw new BankError("Der Beleg ist privat oder bar bezahlt; dort gibt es nichts auszubuchen.");
    if (doc.reverseCharge) throw new BankError("Skonto auf Belege mit § 13b wird nicht unterstützt.");
    if (doc.privateShare > 0) throw new BankError("Skonto auf Belege mit Privatanteil wird nicht unterstützt.");
    if (doc.category === "anlage") throw new BankError("Skonto auf Anlagegüter mindert die Anschaffungskosten und wird nicht unterstützt.");
    const open = documentOpen(doc.gross, await settledOn(tx, "document_id", doc.id));
    amount = input.amount ?? open;
    if (open === 0 || Math.sign(open) !== Math.sign(amount) || Math.abs(amount) > Math.abs(open)) {
      throw new BankError(`Der Beleg ist nur noch über ${Math.abs(open) / 100} € offen.`);
    }
    const rows = await tx.select().from(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, doc.id));
    const taxes = rows.map((r) => ({ rate: r.taxRate, base: r.net, tax: r.tax })).sort((a, b) => b.rate - a.rate);
    const totals = { net: doc.net, tax: doc.tax, gross: doc.gross, taxes };
    lines = documentWriteOffPosting(totals, amount, company.kontenrahmen, doc.vorsteuerAbzug);
    description = `Skonto erhalten · Beleg ${doc.invoiceNumber || doc.filename} · ${doc.supplierName}`;
    target = { invoiceId: null, documentId: doc.id };
  } else {
    const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, input.invoiceId)).for("update");
    if (!invoice || invoice.status !== "final") throw new BankError("Rechnung nicht gefunden.");
    if (invoice.kind === "storno") throw new BankError("Eine Stornorechnung lässt sich nicht ausbuchen.");
    const [storno] = await tx
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.correctsId, invoice.id), eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")));
    if (storno) throw new BankError(`Rechnung ${invoice.number} ist storniert.`);
    const open = invoiceOpen({ ...invoice, paid: await settledOn(tx, "invoice_id", invoice.id), cancelled: false });
    amount = input.amount ?? open;
    if (open === 0 || Math.sign(open) !== Math.sign(amount) || Math.abs(amount) > Math.abs(open)) {
      throw new BankError(`Rechnung ${invoice.number} ist nur noch über ${open / 100} € offen.`);
    }
    const totals = (await invoiceTotalsById([invoice.id], tx)).get(invoice.id)!;
    lines = invoiceWriteOffPosting(input.kind, totals, amount, company.kontenrahmen, company.versteuerung, invoice.taxTreatment);
    description = `${WRITE_OFF_KINDS[input.kind]} · Rechnung ${invoice.number}`;
    target = { invoiceId: invoice.id, documentId: null };
  }
  const [row] = await tx
    .insert(schema.writeOffs)
    .values({
      kind: input.kind,
      ...target,
      date: input.date,
      amount,
      transactionId: input.transactionId ?? null,
    })
    .returning();
  await post(tx, company, { date: input.date, description, sourceType: "ausbuchung", sourceId: row!.id, lines });
  return amount;
}

/** Rest einer Rechnung oder eines Belegs ausbuchen, z. B. einen Forderungsausfall ohne Zahlung */
export async function writeOff(actor: string, input: WriteOffInput): Promise<void> {
  await withActor(actor, async (tx) => {
    await bookWriteOff(tx, await openBooks(tx), input);
  });
}

export const restSchema = z.object({
  transactionId: z.uuid(),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("invoice"), invoiceId: z.uuid() }),
    z.object({ kind: z.literal("document"), documentId: z.uuid() }),
  ]),
  rest: z.enum(["skonto", "forderungsausfall", "skontoErhalten", "kursdifferenz"]),
});

/**
 * Zahlung unter dem offenen Betrag: den offenen Teil des Umsatzes zuordnen und den Rest der Rechnung bzw. des
 * Belegs mit Datum des Umsatzes ausbuchen (Skonto gewährt, Forderungsausfall, Skonto erhalten). Wird die Zuordnung
 * aufgehoben, wird die Ausbuchung mit aufgehoben.
 */
export async function allocateWithRest(actor: string, input: z.infer<typeof restSchema>): Promise<void> {
  await withActor(actor, async (tx) => {
    const company = await openBooks(tx);
    const bank = await lockTransaction(tx, input.transactionId);
    if (bank.open === 0) throw new BankError("Der Umsatz ist schon ganz zugeordnet.");
    if (input.rest === "kursdifferenz") {
      await allocateWithExchangeDifference(tx, company, bank, input.target);
      return;
    }
    const isInvoice = input.target.kind === "invoice";
    if (isInvoice !== (input.rest !== "skontoErhalten")) throw new BankError("Skonto erhalten gilt für Belege, Skonto und Forderungsausfall für Rechnungen.");
    const part: Part = input.target.kind === "invoice" ? { kind: "invoice", invoiceId: input.target.invoiceId, amount: bank.open } : { kind: "document", documentId: input.target.documentId, amount: bank.open };
    await bookPart(tx, company, bank, part, null);
    const base = { date: bank.bookingDate, transactionId: bank.id };
    await bookWriteOff(
      tx,
      company,
      input.target.kind === "invoice"
        ? { ...base, kind: input.rest as "skonto" | "forderungsausfall", invoiceId: input.target.invoiceId }
        : { ...base, kind: "skontoErhalten", documentId: input.target.documentId },
    );
  });
}

/**
 * Zahlung auf eine Rechnung bzw. einen Beleg in Fremdwährung, deren Euro-Betrag vom umgerechneten offenen Betrag abweicht.
 * Weniger als offen: Zahlung zuordnen, Rest als Kursdifferenz ausbuchen. Mehr als offen: als Aufteilung den offenen
 * Betrag auf die Rechnung bzw. den Beleg und den Überschuss als Kursdifferenz. Die Umsatzsteuer bleibt unverändert.
 */
async function allocateWithExchangeDifference(
  tx: Tx,
  company: Awaited<ReturnType<typeof openBooks>>,
  bank: LockedTransaction,
  target: z.infer<typeof restSchema>["target"],
) {
  let open: number;
  if (target.kind === "invoice") {
    const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, target.invoiceId));
    if (!invoice || invoice.status !== "final") throw new BankError("Rechnung nicht zuordenbar.");
    if (invoice.currency === "EUR") throw new BankError("Eine Kursdifferenz gibt es nur bei Rechnungen in Fremdwährung.");
    open = invoiceOpen({ ...invoice, paid: await settledOn(tx, "invoice_id", invoice.id), cancelled: false });
  } else {
    const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, target.documentId));
    if (!doc || doc.status !== "gebucht") throw new BankError("Der Beleg muss erst gebucht sein.");
    if (doc.currency === "EUR") throw new BankError("Eine Kursdifferenz gibt es nur bei Belegen in Fremdwährung.");
    open = documentOpen(doc.gross, await settledOn(tx, "document_id", doc.id));
  }
  if (open === 0 || Math.sign(open) !== Math.sign(bank.open)) throw new BankError("Die Zahlung passt nicht zum offenen Betrag.");
  const toTarget = (amount: number): Part =>
    target.kind === "invoice" ? { kind: "invoice", invoiceId: target.invoiceId, amount } : { kind: "document", documentId: target.documentId, amount };
  if (Math.abs(bank.open) <= Math.abs(open)) {
    await bookPart(tx, company, bank, toTarget(bank.open), null);
    if (bank.open !== open) {
      await bookWriteOff(tx, company, { kind: "kursdifferenz", date: bank.bookingDate, transactionId: bank.id, ...(target.kind === "invoice" ? { invoiceId: target.invoiceId } : { documentId: target.documentId }) });
    }
  } else {
    // Wird die Aufteilung aufgehoben, dann ganz (reverseAllocation)
    const splitId = randomUUID();
    await bookPart(tx, company, bank, toTarget(open), splitId);
    await bookPart(tx, company, bank, { kind: "kursdifferenz", amount: bank.open - open }, splitId);
  }
}

/** Ausbuchungen einer Rechnung bzw. eines Belegs, ohne Gegenzeilen, mit Merker „aufgehoben“ */
export async function listWriteOffs(target: { invoiceId: string } | { documentId: string }) {
  const rows = await db
    .select()
    .from(schema.writeOffs)
    .where("invoiceId" in target ? eq(schema.writeOffs.invoiceId, target.invoiceId) : eq(schema.writeOffs.documentId, target.documentId))
    .orderBy(asc(schema.writeOffs.createdAt));
  const reversed = new Set(rows.flatMap((r) => (r.reversesId ? [r.reversesId] : [])));
  return rows.filter((r) => !r.reversesId).map((r) => ({ ...r, reversed: reversed.has(r.id) }));
}

/**
 * Hebt eine Ausbuchung auf; gehört sie zu einer Zahlung, nur zusammen mit deren Zuordnung (im Bankabgleich). Gebucht
 * wird am Tag der Aufhebung (`date`): Zahlt der Kunde einen ausgebuchten Betrag doch, ist die Umsatzsteuer nach § 17
 * Abs. 2 Nr. 1 Satz 2 UStG im Monat des Zahlungseingangs erneut zu berichtigen, nicht rückwirkend im Monat der Ausbuchung.
 */
export async function reverseWriteOff(actor: string, id: string, date: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [row] = await tx.select().from(schema.writeOffs).where(eq(schema.writeOffs.id, id)).for("update");
    if (!row || row.reversesId) throw new BankError("Ausbuchung nicht gefunden.");
    if (row.transactionId) throw new BankError("Die Ausbuchung gehört zu einer Zahlung; hebe dort im Bankabgleich die Zuordnung auf.");
    const [already] = await tx.select({ id: schema.writeOffs.id }).from(schema.writeOffs).where(eq(schema.writeOffs.reversesId, id));
    if (already) throw new BankError("Die Ausbuchung ist bereits aufgehoben.");
    await reverseWriteOffRow(tx, row, date < row.date ? row.date : date);
  });
}

/** Gegenzeile einer Ausbuchung; mit einer Zuordnung zusammen am Datum der Ausbuchung (= Buchungsdatum des Umsatzes) */
async function reverseWriteOffRow(tx: Tx, row: typeof schema.writeOffs.$inferSelect, date = row.date) {
  const [already] = await tx.select({ id: schema.writeOffs.id }).from(schema.writeOffs).where(eq(schema.writeOffs.reversesId, row.id));
  if (already) return;
  const [entry] = await tx
    .select()
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "ausbuchung"), eq(schema.journalEntries.sourceId, row.id), isNull(schema.journalEntries.reversesId)));
  const lines = entry ? await tx.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, entry.id)) : [];
  const [reversal] = await tx
    .insert(schema.writeOffs)
    .values({ kind: row.kind, invoiceId: row.invoiceId, documentId: row.documentId, date, amount: -row.amount, transactionId: row.transactionId, reversesId: row.id })
    .returning();
  if (entry) {
    await post(tx, await openBooks(tx), {
      date,
      description: `Storno: ${entry.description}`,
      sourceType: "ausbuchung",
      sourceId: reversal!.id,
      lines: reverseLines(lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, taxCode: l.taxCode as PostingLine["taxCode"] }))),
      reversesId: entry.id,
    });
  }
}
