import {
  DARLEHEN_LAUFZEIT_KEYS,
  DARLEHEN_TEIL_KEYS,
  DARLEHEN_ZWECK_KEYS,
  DARLEHENSGEBER_KEYS,
  darlehenKonto,
  darlehenPosting,
  darlehenTeilFehler,
  darlehenText,
  type Cents,
  type DarlehenTeil,
  type Kontenrahmen,
  type PostingLine,
} from "@haben/core";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { loadCompany } from "../stammdaten/index.ts";

/*
 * Darlehen (Roadmap Platz 13): anlegen, Bestand je Darlehen und die Buchung eines Bankumsatzes als Auszahlung, Tilgung,
 * Zinsen oder Gebühren (packages/core/src/darlehen.ts). Der Bestand ist die Restschuld beim Anlegen plus Auszahlungen
 * minus Tilgungen aus dem Bankabgleich, aufgehobene Zuordnungen heben sich mit ihrer Gegenzeile auf.
 */

export class DarlehenError extends UserError {}

export const loanSchema = z.object({
  name: z.string().trim().min(1, "Der Name fehlt.").max(100),
  lender: z.enum(DARLEHENSGEBER_KEYS),
  term: z.enum(DARLEHEN_LAUFZEIT_KEYS),
  purpose: z.enum(DARLEHEN_ZWECK_KEYS),
  /** Restschuld eines laufenden Darlehens am Stichtag; 0 bei einem neuen, das im Bankabgleich ausgezahlt wird */
  openingBalance: z.number().int().min(0),
  openingDate: z.iso.date().nullable(),
});

export const loanPartSchema = z.object({ loanId: z.uuid(), part: z.enum(DARLEHEN_TEIL_KEYS) });

export async function createLoan(actor: string, input: z.input<typeof loanSchema>): Promise<string> {
  const data = loanSchema.parse(input);
  if (data.openingBalance > 0 && !data.openingDate) throw new DarlehenError("Zur Restschuld gehört der Stichtag.");
  if (data.openingBalance === 0 && data.openingDate) throw new DarlehenError("Ein Stichtag gehört nur zu einer Restschuld.");
  const [row] = await withActor(actor, (tx) => tx.insert(schema.loans).values(data).returning({ id: schema.loans.id }));
  return row!.id;
}

/** Bestand je Darlehen: Restschuld beim Anlegen plus Auszahlungen, minus Tilgungen (Vorzeichen wie auf dem Konto) */
async function bestaende(ids: string[], q: Db | Tx): Promise<Map<string, Cents>> {
  if (ids.length === 0) return new Map();
  const rows = await q
    .select({ loanId: schema.allocations.loanId, summe: sql<number>`coalesce(sum(${schema.allocations.amount}), 0)`.mapWith(Number) })
    .from(schema.allocations)
    .where(sql`${inArray(schema.allocations.loanId, ids)} and ${schema.allocations.loanPart} in ('auszahlung', 'tilgung')`)
    .groupBy(schema.allocations.loanId);
  return new Map(rows.map((r) => [r.loanId!, r.summe]));
}

export async function listLoans(q: Db | Tx = db) {
  const { kontenrahmen } = await loadCompany(q);
  const loans = await q.select().from(schema.loans).orderBy(asc(schema.loans.createdAt));
  const bewegt = await bestaende(
    loans.map((l) => l.id),
    q,
  );
  return loans.map((l) => ({
    ...l,
    account: darlehenKonto({ geber: l.lender, laufzeit: l.term }, kontenrahmen),
    balance: l.openingBalance + (bewegt.get(l.id) ?? 0),
  }));
}

/** Buchung eines Teils eines Bankumsatzes zu einem Darlehen; sperrt das Darlehen, damit zwei Tilgungen es nicht überziehen */
export async function darlehenBuchung(
  tx: Tx,
  kontenrahmen: Kontenrahmen,
  bank: { counterpartyName: string },
  loanId: string,
  teil: DarlehenTeil,
  amount: Cents,
): Promise<{ lines: PostingLine[]; description: string; target: { loanId: string; loanPart: DarlehenTeil } }> {
  const [loan] = await tx.select().from(schema.loans).where(eq(schema.loans.id, loanId)).for("update");
  if (!loan) throw new DarlehenError("Darlehen nicht gefunden.");
  const bestand = loan.openingBalance + ((await bestaende([loan.id], tx)).get(loan.id) ?? 0);
  const fehler = darlehenTeilFehler(teil, amount, bestand);
  if (fehler) throw new DarlehenError(fehler);
  const darlehen = { geber: loan.lender, laufzeit: loan.term, zweck: loan.purpose };
  return {
    lines: darlehenPosting(darlehen, teil, amount, kontenrahmen),
    description: `${darlehenText(loan.name, teil)} · ${bank.counterpartyName || "Bankumsatz"}`,
    target: { loanId: loan.id, loanPart: teil },
  };
}

/**
 * Vor dem Aufheben von Zuordnungen: Ohne eine Auszahlung dürfen die Tilgungen den Bestand nicht übersteigen, sonst stünde
 * das Darlehen im Minus, obwohl beim Buchen jede Tilgung auf den Bestand begrenzt ist. Erst die Tilgungen aufheben.
 */
export async function darlehenAufhebenPruefen(
  tx: Tx,
  parts: { loanId: string | null; loanPart: DarlehenTeil | null; amount: Cents }[],
): Promise<void> {
  const wirkung = new Map<string, Cents>();
  for (const p of parts) {
    if (p.loanId && (p.loanPart === "auszahlung" || p.loanPart === "tilgung")) wirkung.set(p.loanId, (wirkung.get(p.loanId) ?? 0) - p.amount);
  }
  if (wirkung.size === 0) return;
  const ids = [...wirkung.keys()];
  const loans = await tx.select().from(schema.loans).where(inArray(schema.loans.id, ids)).for("update");
  const bewegt = await bestaende(ids, tx);
  for (const loan of loans) {
    if (loan.openingBalance + (bewegt.get(loan.id) ?? 0) + wirkung.get(loan.id)! < 0) {
      throw new DarlehenError(`Ohne diese Auszahlung wären die Tilgungen von „${loan.name}“ höher als der Bestand; hebe zuerst die Tilgungen auf.`);
    }
  }
}
