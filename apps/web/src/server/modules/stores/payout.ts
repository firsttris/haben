import { formatEuro, formatRateMonth, PAYMENT_PROVIDERS } from "@haben/core";
import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import { z } from "zod";
import { allocateExchangeDifferenceIn, allocateTransferIn, BankError, storeStatement } from "../bank/index.ts";
import { withActor } from "../../db/actor.ts";
import { bankOpenAmountSql } from "../../db/bank-open.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import type { Store } from "../../db/schema.ts";
import { STORE_LABELS } from "./connections.ts";
import { archivedSettlements } from "./import.ts";

/*
 * Auszahlung eines App-Stores auf das Bankkonto. Keiner der Berichte nennt sie: Google zahlt den Monatsbetrag einige
 * Wochen nach dem Bericht, Apple alle Währungen eines Fiskalmonats gesammelt in Euro zum Kurs am Zahltag. Haben legt
 * deshalb aus dem Bankeingang die Auszahlung im Konto des Stores an und verbindet beide als Geldtransit. Welche
 * Monatsumsätze die Auszahlung bezahlt, wählst du; Haben schlägt die ältesten noch nicht ausgezahlten vor.
 *
 * - Google zahlt in Euro genau den Monatsbetrag; weicht die Summe ab, passt die Auswahl nicht.
 * - Apple: Die Monatsumsätze sind mit dem Umsatzsteuer-Umrechnungskurs umgerechnet, die Zahlung mit Apples Kurs. Die
 *   Differenz bucht Haben als Kursdifferenz (Ertrag oder Aufwand) im Konto des Stores, damit es auf null geht. Eine
 *   Differenz über 10 % der Summe nimmt Haben nicht an: Dann fehlt meist ein Monat oder es ist einer zu viel gewählt.
 */

/** Höchste Kursdifferenz bei Apple, als Anteil der gewählten Monatsumsätze */
const MAX_DIFFERENCE_SHARE = 0.1;

/** Feste Referenzen der Monatsumsätze (stores/reports.ts) */
const MONTHLY_REFERENCE: Record<Store, string> = { googleplay: "googleplay-earnings-%", appstore: "appstore-finance-%" };

/** Welcher Store ist die Gegenpartei eines Bankumsatzes; null, wenn keiner */
export function storeOfCounterparty(name: string): Store | null {
  for (const store of ["googleplay", "appstore"] as const) {
    if (PAYMENT_PROVIDERS[store].pattern.test(name)) return store;
  }
  return null;
}

async function storeAccount(q: typeof db | Tx, store: Store) {
  const [account] = await q
    .select({ id: schema.bankAccounts.id, name: schema.bankAccounts.name })
    .from(schema.bankAccounts)
    .where(and(eq(schema.bankAccounts.purpose, "zahlungsdienstleister"), eq(schema.bankAccounts.provider, store)))
    .orderBy(asc(schema.bankAccounts.createdAt))
    .limit(1);
  return account ?? null;
}

/** Monatsumsätze im Konto des Stores, die noch keine Auszahlung abdeckt, nach Datum */
async function unpaidMonths(q: typeof db | Tx, store: Store, accountId: string) {
  const covered = new Set(
    (await q.select({ covered: schema.storePayouts.covered }).from(schema.storePayouts).where(eq(schema.storePayouts.store, store))).flatMap((r) => r.covered),
  );
  const rows = await q
    .select({
      id: schema.bankTransactions.id,
      bookingDate: schema.bankTransactions.bookingDate,
      amount: schema.bankTransactions.amount,
      purpose: schema.bankTransactions.purpose,
      reference: schema.bankTransactions.bankReference,
    })
    .from(schema.bankTransactions)
    .where(and(eq(schema.bankTransactions.bankAccountId, accountId), like(schema.bankTransactions.bankReference, MONTHLY_REFERENCE[store])))
    .orderBy(asc(schema.bankTransactions.bookingDate), asc(schema.bankTransactions.bankReference));
  return rows.filter((r) => r.reference && !covered.has(r.reference)).map((r) => ({ ...r, reference: r.reference! }));
}

/**
 * Vorschlag: bei Google die ältesten Monate, deren Summe genau den Eingang ergibt; bei Apple alle Umsätze der ältesten
 * Monate, bis die Summe dem Eingang am nächsten kommt.
 */
function suggest(store: Store, months: { id: string; amount: number; bookingDate: string }[], payout: number): string[] {
  let sum = 0;
  let best: { count: number; distance: number } = { count: 0, distance: Math.abs(payout) };
  for (const [i, month] of months.entries()) {
    sum += month.amount;
    // Umsätze desselben Tages (Apple: Währungen eines Fiskalmonats) gehören zusammen
    if (months[i + 1]?.bookingDate === month.bookingDate) continue;
    const distance = Math.abs(payout - sum);
    if (store === "googleplay" && distance === 0) return months.slice(0, i + 1).map((m) => m.id);
    if (store === "appstore" && distance < best.distance) best = { count: i + 1, distance };
  }
  return store === "appstore" ? months.slice(0, best.count).map((m) => m.id) : [];
}

/** Für die Bankseite: Kann dieser Umsatz als Auszahlung eines Stores übernommen werden, und welche Monate stehen offen? */
export async function storePayoutView(transactionId: string) {
  const [bank] = await db
    .select({
      id: schema.bankTransactions.id,
      amount: schema.bankTransactions.amount,
      counterpartyName: schema.bankTransactions.counterpartyName,
      purpose: schema.bankAccounts.purpose,
      open: bankOpenAmountSql.mapWith(Number),
    })
    .from(schema.bankTransactions)
    .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.bankTransactions.bankAccountId))
    .where(eq(schema.bankTransactions.id, transactionId));
  if (!bank || bank.purpose === "zahlungsdienstleister" || bank.amount <= 0 || bank.open !== bank.amount) return null;
  const store = storeOfCounterparty(bank.counterpartyName);
  if (!store) return null;
  const account = await storeAccount(db, store);
  if (!account) return { store, label: STORE_LABELS[store], accountName: null, months: [] };
  const months = await unpaidMonths(db, store, account.id);
  const suggested = new Set(suggest(store, months, bank.amount));
  return {
    store,
    label: STORE_LABELS[store],
    accountName: account.name,
    months: months.map((m) => ({ id: m.id, bookingDate: m.bookingDate, amount: m.amount, purpose: m.purpose, suggested: suggested.has(m.id) })),
  };
}

export type StorePayoutView = NonNullable<Awaited<ReturnType<typeof storePayoutView>>>;

export const storePayoutSchema = z.object({ transactionId: z.uuid(), monthIds: z.array(z.uuid()).min(1).max(60) });

/**
 * Apple: Jede Währung der gewählten Fiskalmonate mit einem Erlösanteil muss im Konto stehen. Fehlt eine (meist ohne Umrechnungskurs), steckt
 * ihr Erlösanteil in der Zahlung und landete sonst als Kursdifferenz statt als Umsatz an die Store-Gesellschaft.
 */
async function requireAllCurrencies(tx: Tx, accountId: string, chosen: { reference: string }[]) {
  const periods = [...new Set(chosen.map((m) => /^appstore-finance-(\d{4}-\d{2})-/.exec(m.reference)?.[1]).filter((p): p is string => !!p))];
  // Ein Erlösanteil von null (Verkauf und Rückgabe im selben Fiskalmonat) fehlt nicht, auch ohne Kurs
  const settlements = (await archivedSettlements("appstore", periods)).filter((s) => s.net !== 0);
  if (settlements.length === 0) return;
  const present = new Set(
    (
      await tx
        .select({ reference: schema.bankTransactions.bankReference })
        .from(schema.bankTransactions)
        .where(
          and(
            eq(schema.bankTransactions.bankAccountId, accountId),
            inArray(
              schema.bankTransactions.bankReference,
              settlements.map((s) => s.reference),
            ),
          ),
        )
    ).map((r) => r.reference),
  );
  const missing = settlements.filter((s) => !present.has(s.reference));
  if (missing.length > 0) {
    throw new BankError(
      `Im Konto fehlt noch der Erlösanteil ${missing.map((s) => `${s.currency} (Fiskalmonat ${formatRateMonth(s.period)})`).join(", ")}, meist weil der Umsatzsteuer-Umrechnungskurs fehlt. Trage ihn unter Einstellungen › Fremdwährung ein und rufe die Berichte erneut ab; sonst bucht Haben den Anteil als Kursdifferenz.`,
    );
  }
}

/**
 * Legt aus dem Bankeingang die Auszahlung im Konto des Stores an, verbindet beide als Geldtransit und bucht bei Apple die
 * Kursdifferenz. Alles in einer Transaktion: Passt etwas nicht, bleibt nichts zurück.
 */
export async function takeOverStorePayout(actor: string, input: z.input<typeof storePayoutSchema>): Promise<{ difference: number }> {
  const data = storePayoutSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [bank] = await tx
      .select({
        id: schema.bankTransactions.id,
        amount: schema.bankTransactions.amount,
        bookingDate: schema.bankTransactions.bookingDate,
        counterpartyName: schema.bankTransactions.counterpartyName,
        accountName: schema.bankAccounts.name,
        purpose: schema.bankAccounts.purpose,
        open: bankOpenAmountSql.mapWith(Number),
      })
      .from(schema.bankTransactions)
      .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.bankTransactions.bankAccountId))
      .where(eq(schema.bankTransactions.id, data.transactionId))
      .for("update", { of: schema.bankTransactions });
    if (!bank) throw new BankError("Umsatz nicht gefunden.");
    const store = storeOfCounterparty(bank.counterpartyName);
    if (!store || bank.purpose === "zahlungsdienstleister" || bank.amount <= 0)
      throw new BankError("Das ist kein Eingang von Google Play oder App Store auf einem Bankkonto.");
    if (bank.open !== bank.amount) throw new BankError("Der Eingang muss noch ganz offen sein.");
    const label = STORE_LABELS[store];
    const account = await storeAccount(tx, store);
    if (!account) throw new BankError(`Für ${label} gibt es noch kein Konto. Lege es unter Bank als Zahlungsdienstleister an.`);
    // Zwei gleichzeitige Übernahmen sähen sonst dieselben Monate als offen
    await tx.select({ id: schema.bankAccounts.id }).from(schema.bankAccounts).where(eq(schema.bankAccounts.id, account.id)).for("update");

    const unpaid = await unpaidMonths(tx, store, account.id);
    const chosen = unpaid.filter((m) => data.monthIds.includes(m.id));
    if (chosen.length !== new Set(data.monthIds).size) throw new BankError("Ein gewählter Monat ist schon ausgezahlt oder gehört nicht zu diesem Konto.");
    if (store === "appstore") await requireAllCurrencies(tx, account.id, chosen);
    const sum = chosen.reduce((s, m) => s + m.amount, 0);
    const difference = bank.amount - sum;
    if (store === "googleplay" && difference !== 0) {
      throw new BankError(
        `Die gewählten Monate ergeben ${formatEuro(sum)}, der Eingang ${formatEuro(bank.amount)}. Google zahlt in Euro genau die Monatsbeträge.`,
      );
    }
    if (sum <= 0 || Math.abs(difference) > Math.abs(sum) * MAX_DIFFERENCE_SHARE) {
      throw new BankError(
        `Die gewählten Monate ergeben ${formatEuro(sum)}, der Eingang ${formatEuro(bank.amount)}. Eine so große Kursdifferenz nimmt Haben nicht an; fehlt ein Monat oder ist einer zu viel gewählt?`,
      );
    }

    const months = chosen.map((m) => m.reference);
    const payoutReference = `${store}-payout-${bank.id}`;
    const differenceReference = `${store}-kursdifferenz-${bank.id}`;
    const transactions = [
      {
        bookingDate: bank.bookingDate,
        amount: -bank.amount,
        currency: "EUR",
        counterpartyName: bank.accountName,
        purpose: `Auszahlung ${label} auf ${bank.accountName} für ${months.join(", ")}`,
        type: "Auszahlung",
        bankReference: payoutReference,
        index: 0,
      },
      ...(difference === 0
        ? []
        : [
            {
              bookingDate: bank.bookingDate,
              amount: difference,
              currency: "EUR",
              counterpartyName: label,
              purpose: `Kursdifferenz ${label}: Zahlung ${formatEuro(bank.amount)}, Monatsbeträge zum Umsatzsteuer-Umrechnungskurs ${formatEuro(sum)}`,
              type: "Kursdifferenz",
              bankReference: differenceReference,
              index: 1,
            },
          ]),
    ];
    await storeStatement(
      tx,
      { format: "store-payout", currency: "EUR", periodFrom: bank.bookingDate, periodTo: bank.bookingDate, transactions, warnings: [] },
      { filename: `Auszahlung ${label} ${bank.bookingDate}`, sha256: payoutReference },
      account.id,
    );
    const created = await tx
      .select({ id: schema.bankTransactions.id, reference: schema.bankTransactions.bankReference })
      .from(schema.bankTransactions)
      .where(
        and(
          eq(schema.bankTransactions.bankAccountId, account.id),
          or(eq(schema.bankTransactions.bankReference, payoutReference), eq(schema.bankTransactions.bankReference, differenceReference)),
        ),
      );
    const payout = created.find((r) => r.reference === payoutReference);
    const differenceRow = created.find((r) => r.reference === differenceReference);
    if (!payout || (difference !== 0 && !differenceRow)) throw new BankError("Die Auszahlung ist im Konto des Stores schon angelegt.");

    await allocateTransferIn(tx, { transactionId: bank.id, counterpartId: payout.id });
    if (differenceRow) await allocateExchangeDifferenceIn(tx, differenceRow.id);
    await tx.insert(schema.storePayouts).values({
      store,
      bankTransactionId: bank.id,
      payoutTransactionId: payout.id,
      differenceTransactionId: differenceRow?.id ?? null,
      covered: months,
    });
    return { difference };
  });
}
