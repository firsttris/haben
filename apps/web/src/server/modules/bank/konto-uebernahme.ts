import { eq } from "drizzle-orm";
import { decrypt } from "../../crypto.ts";
import { schema, type Tx } from "../../db/index.ts";
import { keineExterneQuelle } from "./abruf-bindung.ts";

/**
 * Ein Konto, ein Abruf (#654): Verbindet Enable Banking oder FinTS ein Konto, fällt es aus jeder anderen Verbindung,
 * über welchen Weg auch immer. Beide Wege schreiben den Verwendungszweck verschieden, der Dubletten-Hash erkennte
 * dieselbe Zahlung sonst nicht. Ein Konto mit externer Quelle verbindet keiner der beiden Wege (Fehler).
 *
 * Eine Zustimmung bei Enable Banking ohne Konten wird gelöscht; ihre Sitzungen gibt die Funktion zurück, damit der
 * Aufrufer sie nach der Transaktion auch bei Enable Banking beendet. Eine FinTS-Verbindung ohne Konten bleibt stehen,
 * bis jemand sie trennt: Sie hält den Zugang zur Bank, und weitere Konten kann sie beim nächsten Verbinden wieder
 * bekommen.
 *
 * @param ausser die Zustimmung bei Enable Banking, die die Konten gerade bekommt
 */
export async function kontenUebernehmen(tx: Tx, bankAccountIds: Set<string>, ausser?: string): Promise<string[]> {
  if (bankAccountIds.size === 0) return [];
  await keineExterneQuelle(tx, [...bankAccountIds]);
  const sitzungen: string[] = [];
  const fints = await tx.select({ id: schema.fintsConnections.id, accounts: schema.fintsConnections.accounts }).from(schema.fintsConnections);
  for (const v of fints) {
    const bleiben = v.accounts.filter((a) => !bankAccountIds.has(a.bankAccountId));
    if (bleiben.length < v.accounts.length) await tx.update(schema.fintsConnections).set({ accounts: bleiben }).where(eq(schema.fintsConnections.id, v.id));
  }
  const eb = await tx
    .select({ id: schema.bankConnections.id, accounts: schema.bankConnections.accounts, ciphertext: schema.bankConnections.ciphertext })
    .from(schema.bankConnections);
  for (const c of eb) {
    if (c.id === ausser) continue;
    const bleiben = c.accounts.filter((a) => !bankAccountIds.has(a.bankAccountId));
    if (bleiben.length === c.accounts.length) continue;
    if (bleiben.length > 0) {
      await tx.update(schema.bankConnections).set({ accounts: bleiben }).where(eq(schema.bankConnections.id, c.id));
      continue;
    }
    if (c.ciphertext) sitzungen.push(decrypt(c.ciphertext).toString("utf8"));
    await tx.delete(schema.bankConnections).where(eq(schema.bankConnections.id, c.id));
  }
  return sitzungen;
}

/** Hinweis nach dem Verbinden auf Konten, die Haben dabei angelegt hat */
export function neuAngelegt(namen: string[]): string | null {
  return namen.length > 0 ? `Neu angelegt: ${namen.join(", ")}. Name und Zweck (z. B. Steuerkonto) legst du unter Bank mit „Name und Zweck“ fest.` : null;
}

/** Hinweis auf Konten in Fremdwährung, die Haben nicht abruft */
export function fremdwaehrung(waehrungen: string[]): string | null {
  if (waehrungen.length === 0) return null;
  return `${waehrungen.length} Konten in Fremdwährung (${[...new Set(waehrungen)].join(", ")}) werden nicht abgerufen, Haben bucht nur in Euro.`;
}
