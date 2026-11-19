import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";

/**
 * Ob die Kundennummer des Kontakts in einem Kundenkreis festgeschriebener Belege steckt (#1426). Dann darf sie sich
 * nicht mehr ändern: Die Nummer der Belege würde sonst einem Kontakt zeigen, dessen Nummernkreis sie nicht mehr ist.
 * Belege im gemeinsamen Kreis (number_contact_id NULL) sperren nicht — deren Nummer hängt nicht am Kunden.
 */
export async function customerNumberLocked(tx: Tx, id: string): Promise<boolean> {
  const [numbered] = await tx
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.numberContactId, id), eq(schema.invoices.status, "final")))
    .limit(1);
  if (numbered) return true;
  const [numberedQuote] = await tx
    .select({ id: schema.quotes.id })
    .from(schema.quotes)
    .where(and(eq(schema.quotes.numberContactId, id), eq(schema.quotes.status, "final")))
    .limit(1);
  return numberedQuote !== undefined;
}
