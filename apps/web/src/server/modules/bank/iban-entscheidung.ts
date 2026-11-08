import { compactIban, ibanAbgleich, type IbanAbgleich, type IbanEntscheidung, type IbanWahl } from "@haben/core";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { BankError } from "./bank.ts";
import { documentPayees } from "./document-payees.ts";

/**
 * Abweichende IBAN der E-Rechnung am Beleg (#410): der Abgleich mit dem Kontakt (ibanAbgleich in @haben/core) und die
 * Entscheidung je Beleg, welche IBAN gilt. Die Entscheidung steht in einer eigenen, nur anhängbaren Tabelle, damit sie
 * auch am gebuchten Beleg möglich ist, ohne dessen Sperre zu lockern; Kontakt und Beleg bleiben unverändert.
 */

/** Entscheidungen je Beleg, mit dem Namen der Person (sonst ihrer Kennung) */
export async function ibanDecisions(ids: string[], q: Db | Tx = db): Promise<Map<string, IbanEntscheidung[]>> {
  if (ids.length === 0) return new Map();
  const rows = await q
    .select({
      documentId: schema.documentIbanDecisions.documentId,
      kontaktIban: schema.documentIbanDecisions.kontaktIban,
      rechnungsIban: schema.documentIbanDecisions.rechnungsIban,
      wahl: schema.documentIbanDecisions.wahl,
      am: schema.documentIbanDecisions.createdAt,
      decidedBy: schema.documentIbanDecisions.decidedBy,
      name: schema.user.name,
    })
    .from(schema.documentIbanDecisions)
    .leftJoin(schema.user, eq(schema.user.id, schema.documentIbanDecisions.decidedBy))
    .where(inArray(schema.documentIbanDecisions.documentId, ids));
  const map = new Map<string, IbanEntscheidung[]>();
  for (const { documentId, decidedBy, name, ...e } of rows) map.set(documentId, [...(map.get(documentId) ?? []), { ...e, von: name ?? decidedBy }]);
  return map;
}

/** Abgleich der IBANs für die Belegseite */
export async function documentIbanCheck(documentId: string, q: Db | Tx = db): Promise<IbanAbgleich> {
  const [payees, decisions] = await Promise.all([documentPayees([documentId], q), ibanDecisions([documentId], q)]);
  const payee = payees.get(documentId);
  return ibanAbgleich({ kontaktIban: payee?.contactIban ?? null, rechnungsIban: payee?.einvoiceIban ?? null }, decisions.get(documentId) ?? []);
}

export const ibanDecisionSchema = z.object({
  wahl: z.enum(["kontakt", "e-rechnung"]),
  /** Die IBANs, die die Person gesehen hat; passen sie nicht mehr, entscheidet sie nicht über etwas anderes */
  kontaktIban: z.string().trim().min(1).max(40),
  rechnungsIban: z.string().trim().min(1).max(40),
});

export type IbanDecisionInput = z.infer<typeof ibanDecisionSchema>;

/** Hält fest, welche IBAN für diesen Beleg gilt; nur bei einer Abweichung und nur für das gesehene Paar */
export async function decideDocumentIban(actor: string, documentId: string, input: IbanDecisionInput): Promise<void> {
  const parsed = ibanDecisionSchema.parse(input);
  await withActor(actor, async (tx) => {
    // Eine Entscheidung gilt nur für das geprüfte Paar: ändert sich der Kontakt danach, passt sie nicht mehr (ibanAbgleich)
    const [doc] = await tx
      .select({ id: schema.documents.id, lockedAt: schema.documents.lockedAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .for("share");
    if (!doc) throw new BankError("Beleg nicht gefunden.");
    // Erst am gebuchten Beleg: ein offener lässt sich löschen, die nur anhängbare Entscheidung hielte ihn per Fremdschlüssel fest
    if (!doc.lockedAt) throw new BankError("Welche IBAN gilt, entscheidest du nach dem Buchen des Belegs.");
    const check = await documentIbanCheck(documentId, tx);
    if (check.art !== "abweichend" || check.kontaktIban !== compactIban(parsed.kontaktIban) || check.rechnungsIban !== compactIban(parsed.rechnungsIban)) {
      throw new BankError("Die IBANs haben sich geändert. Bitte die Seite neu laden und noch einmal entscheiden.");
    }
    await tx.insert(schema.documentIbanDecisions).values({
      documentId,
      kontaktIban: check.kontaktIban,
      rechnungsIban: check.rechnungsIban,
      wahl: parsed.wahl satisfies IbanWahl,
      decidedBy: actor,
    });
  });
}
