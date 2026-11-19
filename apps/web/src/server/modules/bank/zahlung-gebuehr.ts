import { gebuehrReferenzen, inCents } from "@haben/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { bankDuplicateConfirmedSql } from "../../db/bank-open.ts";
import { schema } from "../../db/index.ts";
import { allocateIn } from "./allocation.ts";
import { BankError } from "./bank-error.ts";
import { lockTransaction } from "./payment-booking.ts";

export const zahlungMitGebuehrSchema = z.object({
  /** Die Zahlung; ihre Gebühr findet der Server selbst */
  transactionId: z.uuid(),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("invoice"), invoiceId: z.uuid() }),
    z.object({ kind: z.literal("document"), documentId: z.uuid() }),
  ]),
  /** Betrag der Zahlung, die ganz zugeordnet wird */
  amount: inCents(z.number().int()),
  /** Gebuchter Beleg der Gebühr (Rechnung des Dienstleisters): Vorsteuer bzw. § 13b laufen über ihn; ohne Beleg ohne Steuer */
  gebuehrBelegId: z.uuid().optional(),
});

/**
 * Zahlung eines Zahlungsdienstleisters samt der einbehaltenen Gebühr in einem Schritt: Die Zahlung wird mit dem vollen
 * Bruttobetrag der Rechnung bzw. dem Beleg zugeordnet (voller Erlös), die Gebühr derselben Bewegung als Gebühr
 * gebucht (Nebenkosten des Geldverkehrs, ohne Steuer) oder, mit `gebuehrBelegId`, dem Beleg der Gebühr zugeordnet. Beides in einer Transaktion; die Zuordnungen bleiben einzeln und lassen
 * sich einzeln aufheben. Die Bewegung erkennt Haben an der Referenz der Gebühr (zahlung-gebuehr.ts in @haben/core).
 */
export async function allocatePaymentWithFee(actor: string, input: z.infer<typeof zahlungMitGebuehrSchema>): Promise<void> {
  await withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ account: schema.bankTransactions.bankAccountId, reference: schema.bankTransactions.bankReference })
      .from(schema.bankTransactions)
      .where(eq(schema.bankTransactions.id, input.transactionId));
    if (!row) throw new BankError("Umsatz nicht gefunden.");
    const references = gebuehrReferenzen(row.reference);
    const fees = references.length
      ? await tx
          .select({ id: schema.bankTransactions.id })
          .from(schema.bankTransactions)
          // Eine bestätigte Dublette (#865) zählt wie in Liste und Zähler nicht mit
          .where(
            and(
              eq(schema.bankTransactions.bankAccountId, row.account),
              inArray(schema.bankTransactions.bankReference, references),
              sql`not ${bankDuplicateConfirmedSql}`,
            ),
          )
      : [];
    if (fees.length !== 1) throw new BankError("Zu dieser Zahlung gibt es keine eindeutige Gebühr derselben Bewegung.");
    const payment = await lockTransaction(tx, input.transactionId);
    const fee = await lockTransaction(tx, fees[0]!.id);
    if (payment.purpose !== "zahlungsdienstleister") throw new BankError("Zahlung und Gebühr gibt es nur im Konto eines Zahlungsdienstleisters.");
    if (payment.amount <= 0 || fee.amount >= 0) throw new BankError("Zahlung und Gebühr gibt es nur für einen Eingang mit einer abgezogenen Gebühr.");
    if (fee.open === 0) throw new BankError("Die Gebühr ist schon zugeordnet.");
    if (payment.open !== payment.amount || fee.open !== fee.amount) throw new BankError("Zahlung und Gebühr müssen noch ganz offen sein.");
    if (input.amount !== payment.open) throw new BankError("Mit der Gebühr wird die ganze Zahlung zugeordnet.");
    await allocateIn(tx, {
      ...(input.target.kind === "invoice"
        ? { kind: "invoice" as const, invoiceId: input.target.invoiceId }
        : { kind: "document" as const, documentId: input.target.documentId }),
      transactionId: payment.id,
      amount: input.amount,
    });
    await allocateIn(
      tx,
      input.gebuehrBelegId
        ? { kind: "document", documentId: input.gebuehrBelegId, transactionId: fee.id, amount: fee.open }
        : { kind: "gebuehren", transactionId: fee.id, amount: fee.open },
    );
  });
}
