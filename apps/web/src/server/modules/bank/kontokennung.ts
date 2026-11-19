import { and, eq } from "drizzle-orm";
import { type EbAccount, EnableBankingApiError } from "@haben/import";
import { db, schema } from "../../db/index.ts";
import type { BankConnectionAccount } from "../../db/schema.ts";
import { BankError } from "./bank-error.ts";

/**
 * Kontokennung für die Quellenbindung: gespeichert, sonst aus einer schon bestehenden Bindung des Kontos, sonst aus den
 * Kontodetails der Bank; null, wenn die Bank keine nennt. Ist die Bank nicht erreichbar, Fehler statt Rückfall auf den
 * Weg ohne Vertrag: Dessen Umsätze erkennte ein späterer Abruf mit Kennung nicht wieder.
 */
export async function kontokennung(account: BankConnectionAccount, details: () => Promise<EbAccount>): Promise<string | null> {
  if (account.identificationHash) return account.identificationHash;
  const [bound] = await db
    .select({ externalAccountId: schema.importSources.externalAccountId })
    .from(schema.importSources)
    .where(and(eq(schema.importSources.bankAccountId, account.bankAccountId), eq(schema.importSources.provider, "enablebanking")))
    .limit(1);
  if (bound) return bound.externalAccountId;
  if (account.identificationHash === null) return null;
  try {
    return (await details()).identification_hash || null;
  } catch (error) {
    if (error instanceof EnableBankingApiError && error.status === 404) return null;
    throw new BankError(`Kennung des Kontos bei der Bank nicht abrufbar (${error instanceof Error ? error.message : String(error)}); nichts gespeichert.`);
  }
}
