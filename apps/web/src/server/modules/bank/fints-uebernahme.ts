import { eq } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";

/**
 * Ein Konto bekommt seine Umsätze aus einem Abruf (#654): Verbindet Enable Banking ein Konto, das schon über FinTS
 * abgerufen wird, fällt es aus der FinTS-Verbindung. Beide Wege schreiben den Verwendungszweck verschieden, der
 * Dubletten-Hash erkennte dieselbe Zahlung sonst nicht. Eine FinTS-Verbindung ohne Konten bleibt stehen, bis jemand sie
 * trennt: Sie hält den Zugang zur Bank, und weitere Konten kann sie beim nächsten Verbinden wieder bekommen.
 */
export async function fintsKontenAbgeben(tx: Tx, bankAccountIds: Set<string>): Promise<void> {
  if (bankAccountIds.size === 0) return;
  const verbindungen = await tx.select({ id: schema.fintsConnections.id, accounts: schema.fintsConnections.accounts }).from(schema.fintsConnections);
  for (const v of verbindungen) {
    const bleiben = v.accounts.filter((a) => !bankAccountIds.has(a.bankAccountId));
    if (bleiben.length < v.accounts.length) await tx.update(schema.fintsConnections).set({ accounts: bleiben }).where(eq(schema.fintsConnections.id, v.id));
  }
}
