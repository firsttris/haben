import { compactIban, ibanAbgleich, isValidIban, type IbanAbgleich, type IbanWahl } from "@haben/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { setContactIbanIfEmpty } from "../stammdaten/index.ts";
import { BankError } from "./bank.ts";
import { documentPayees, ibanDecisions } from "./document-payees.ts";

/**
 * Abweichende IBAN der E-Rechnung am Beleg (#410): der Abgleich mit dem Kontakt (ibanAbgleich in @haben/core) und die
 * Entscheidung je Beleg, welche IBAN gilt. Die Entscheidung steht in einer eigenen, nur anhängbaren Tabelle, damit sie
 * auch am gebuchten Beleg möglich ist, ohne dessen Sperre zu lockern; Kontakt und Beleg bleiben unverändert.
 */

/** Abgleich der IBANs für die Belegseite */
export async function documentIbanCheck(documentId: string, q: Db | Tx = db): Promise<IbanAbgleich> {
  const [payees, decisions] = await Promise.all([documentPayees([documentId], q), ibanDecisions([documentId], q)]);
  const payee = payees.get(documentId);
  return ibanAbgleich({ kontaktIban: payee?.contactIban ?? null, rechnungsIban: payee?.einvoiceIban ?? null }, decisions.get(documentId) ?? []);
}

export const ibanDecisionSchema = z.object({
  wahl: z.enum(["kontakt", "e-rechnung"]),
  /** Die IBANs, die die Person gesehen hat; passen sie nicht mehr, entscheidet sie nicht über etwas anderes */
  /** null: Kontakt ohne IBAN, bestätigt wird die IBAN aus der E-Rechnung */
  kontaktIban: z.string().trim().min(1).max(40).nullable(),
  rechnungsIban: z.string().trim().min(1).max(40),
  /** Nur bei der Bestätigung: die IBAN zusätzlich in den Kontakt eintragen, der noch keine hat (eigener, freiwilliger Schritt) */
  auchInKontakt: z.boolean().default(false),
});

export type IbanDecisionInput = z.input<typeof ibanDecisionSchema>;

/**
 * Hält fest, welche IBAN für diesen Beleg gilt, nur für das gesehene Paar: bei einer Abweichung die des Kontakts oder
 * die der E-Rechnung, bei einem Kontakt ohne IBAN die Bestätigung der IBAN aus der E-Rechnung, auf Wunsch zusätzlich im
 * Kontakt. Einen Kontakt mit IBAN ändert Haben dabei nie.
 */
export async function decideDocumentIban(actor: string, documentId: string, input: IbanDecisionInput): Promise<void> {
  const parsed = ibanDecisionSchema.parse(input);
  await withActor(actor, async (tx) => {
    // Eine Entscheidung gilt nur für das geprüfte Paar: ändert sich der Kontakt danach, passt sie nicht mehr (ibanAbgleich)
    const [doc] = await tx
      .select({ id: schema.documents.id, lockedAt: schema.documents.lockedAt, contactId: schema.documents.supplierContactId })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .for("share");
    if (!doc) throw new BankError("Beleg nicht gefunden.");
    // Erst am gebuchten Beleg: ein offener lässt sich löschen, die nur anhängbare Entscheidung hielte ihn per Fremdschlüssel fest
    if (!doc.lockedAt) throw new BankError("Welche IBAN gilt, entscheidest du nach dem Buchen des Belegs.");
    if (parsed.kontaktIban === null && parsed.wahl === "kontakt") {
      throw new BankError("Ohne IBAN im Kontakt lässt sich nur die IBAN aus der E-Rechnung bestätigen.");
    }
    if (parsed.auchInKontakt && (parsed.kontaktIban !== null || parsed.wahl !== "e-rechnung")) {
      throw new BankError("In den Kontakt kommt eine IBAN nur, wenn er noch keine hat.");
    }
    if (parsed.auchInKontakt && !doc.contactId) throw new BankError("Am Beleg hängt kein Kontakt, in den die IBAN kommen könnte.");
    const check = await documentIbanCheck(documentId, tx);
    const seen = parsed.kontaktIban === null ? null : compactIban(parsed.kontaktIban);
    const matches =
      check.art === "abweichend"
        ? check.kontaktIban === seen && check.rechnungsIban === compactIban(parsed.rechnungsIban)
        : check.art === "ungeprueft" && seen === null && check.rechnungsIban === compactIban(parsed.rechnungsIban);
    if (!matches || check.art === "keine" || check.art === "gleich") {
      throw new BankError("Die IBANs haben sich geändert. Bitte die Seite neu laden und noch einmal entscheiden.");
    }
    // BT-84 muss keine IBAN sein (EN 16931) und kommt ungeprüft aus der E-Rechnung; in den Kontakt nur eine gültige
    if (parsed.auchInKontakt && !isValidIban(check.rechnungsIban)) {
      throw new BankError("Die Bankverbindung aus der E-Rechnung ist keine gültige IBAN; in den Kontakt kommt sie so nicht.");
    }
    await tx.insert(schema.documentIbanDecisions).values({
      documentId,
      kontaktIban: check.art === "abweichend" ? check.kontaktIban : null,
      rechnungsIban: check.rechnungsIban,
      wahl: parsed.wahl satisfies IbanWahl,
      decidedBy: actor,
    });
    if (parsed.auchInKontakt && doc.contactId && !(await setContactIbanIfEmpty(tx, doc.contactId, check.rechnungsIban))) {
      throw new BankError("Die IBANs haben sich geändert. Bitte die Seite neu laden und noch einmal entscheiden.");
    }
  });
}
