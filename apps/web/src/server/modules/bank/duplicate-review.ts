import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { separateDuplicateFetchesSql } from "../../db/bank-open.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

export const duplicateDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ id: z.uuid(), decision: z.enum(["duplicate", "distinct"]), requestId: z.uuid() }),
  z.object({ id: z.uuid(), decision: z.literal("pending"), decisionId: z.uuid() }),
]);
type DuplicateDecision = z.infer<typeof duplicateDecisionSchema>["decision"];
export type DuplicateDecisionInput = z.input<typeof duplicateDecisionSchema>;

export async function decideDuplicate(actor: string, input: DuplicateDecisionInput) {
  const data = duplicateDecisionSchema.parse(input);
  const { id, decision } = data;
  await withActor(actor, async (tx) => {
    const [review] = await tx.select().from(schema.bankDuplicateReviews).where(eq(schema.bankDuplicateReviews.id, id));
    if (!review) throw new UserError("Dublettenverdacht nicht gefunden.");
    await tx
      .select({ id: schema.bankTransactions.id })
      .from(schema.bankTransactions)
      .where(inArray(schema.bankTransactions.id, [review.transactionId, review.originalTransactionId]))
      .orderBy(asc(schema.bankTransactions.id))
      .for("update");
    const decisions = schema.bankDuplicateDecisions;
    const same = decision === "pending" ? eq(decisions.reversesId, data.decisionId) : eq(decisions.id, data.requestId);
    const [already] = await tx
      .select({ id: decisions.id })
      .from(decisions)
      .where(and(eq(decisions.reviewId, id), eq(decisions.decision, decision), same));
    if (already) return;
    // Die Ereignis-ID erkennt dieselbe Bestätigung auch nach ihrer Rücknahme wieder.
    await tx.insert(decisions).values({
      id: decision === "pending" ? undefined : data.requestId,
      reviewId: id,
      decision,
      reversesId: decision === "pending" ? data.decisionId : null,
    });
  });
}

export async function duplicateReviewsForTransaction(id: string) {
  return Array.from(
    await db.execute<{
      id: string;
      decision: DuplicateDecision;
      decisionId: string | null;
      requestId: string;
      sharedFetch: boolean;
      confirmationBlockReason: string | null;
      originalId: string;
      originalPurpose: string | null;
      originalName: string | null;
      originalDate: string;
    }>(sql`
    select dupe.id, original.id as "originalId", original.purpose as "originalPurpose",
      original.counterparty_name as "originalName", original.booking_date::text as "originalDate",
      coalesce(d.decision, 'pending') as decision, d.id as "decisionId",
      gen_random_uuid()::text as "requestId", not (${separateDuplicateFetchesSql}) as "sharedFetch",
      case when d.decision is distinct from 'distinct' then
        haben_bank_duplicate_block_reason(dupe.transaction_id, dupe.original_transaction_id)
      end as "confirmationBlockReason"
    from bank_duplicate_reviews dupe join bank_transactions original on original.id = dupe.original_transaction_id
    left join bank_duplicate_decisions d on d.id = haben_active_bank_duplicate_decision(dupe.id)
    where dupe.transaction_id = ${id} and (d.id is not null or (not haben_bank_duplicate(dupe.transaction_id) and ${separateDuplicateFetchesSql}))
    order by dupe.created_at, dupe.id
  `),
  );
}
