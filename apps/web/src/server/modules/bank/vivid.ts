import { vividIban } from "@haben/import";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { accountForIban, BankError } from "./bank.ts";
import { accountFetchFrom, zustimmungenBeenden } from "./bank-sync.ts";
import { fremdwaehrung, kontenUebernehmen, neuAngelegt } from "./konto-uebernahme.ts";
import { type VividErgebnis, vividAbrufen, vividClientFor } from "./vivid-abruf.ts";
import { encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { BankConnectionAccount } from "../../db/schema.ts";
import { today as todayInGermany } from "../../today.ts";

/*
 * Kontoabruf über die Vivid Business API (#1393), Verbinden: Schlüssel prüfen, Konten über die IBAN zuordnen, Schlüssel
 * verschlüsselt speichern und gleich den ersten Abruf starten.
 */

export const vividVerbindenSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(1, "Der API-Schlüssel fehlt.")
    .max(500)
    // Vivid: „Send the key … exactly as issued, with nothing in front of it“
    .refine((k) => !/^bearer\s/i.test(k) && !/\s/.test(k), "Den API-Schlüssel ohne „Bearer“ und ohne Leerzeichen eintragen."),
  /** Erster Abruf neuer Konten ab diesem Tag; fehlt = ab Jahresbeginn */
  fetchFrom: z.iso.date().nullish(),
});

/**
 * Legt die Verbindung an und ordnet die Konten in Euro über die IBAN zu (fehlende werden angelegt). Ein neuer Schlüssel
 * für dieselben Konten löst den alten ab und übernimmt dessen Abrufstand; Konten, die bisher Enable Banking oder FinTS
 * abruft, gehen auf Vivid über.
 */
export async function vividVerbinden(actor: string, input: z.input<typeof vividVerbindenSchema>, now = new Date()): Promise<VividErgebnis> {
  const today = todayInGermany(now);
  const data = vividVerbindenSchema.parse(input);
  if (data.fetchFrom && data.fetchFrom > today) throw new BankError("Der Abruf kann nicht in der Zukunft beginnen.");
  let konten;
  try {
    konten = await vividClientFor(data.apiKey).accounts();
  } catch (error) {
    throw new BankError(`Vivid hat den Schlüssel nicht angenommen: ${error instanceof Error ? error.message : String(error)}`);
  }
  const euro = konten.filter((k) => (k.currency || "EUR") === "EUR");
  const fremd = konten.filter((k) => (k.currency || "EUR") !== "EUR").map((k) => k.currency!);
  const abrufbar = euro.flatMap((k) => {
    const iban = vividIban(k);
    return iban ? [{ konto: k, iban }] : [];
  });
  if (abrufbar.length === 0) {
    throw new BankError(
      konten.length === 0
        ? "Vivid nennt für diesen Schlüssel kein Konto. Darf die Person, die ihn angelegt hat, die Konten in der App sehen?"
        : "Vivid nennt kein Konto in Euro mit IBAN.",
    );
  }
  const neu: string[] = [];
  const { id, beenden } = await withActor(actor, async (tx) => {
    const vorherige = [
      ...(await tx.select({ accounts: schema.vividConnections.accounts }).from(schema.vividConnections)),
      ...(await tx.select({ accounts: schema.fintsConnections.accounts }).from(schema.fintsConnections)),
      ...(await tx.select({ accounts: schema.bankConnections.accounts }).from(schema.bankConnections)),
    ].flatMap((c) => c.accounts);
    const accounts: BankConnectionAccount[] = [];
    for (const { konto, iban } of abrufbar) {
      const [bekannt] = await tx.select({ id: schema.bankAccounts.id }).from(schema.bankAccounts).where(eq(schema.bankAccounts.iban, iban));
      const bankAccount = await accountForIban(tx, iban, `Vivid${konto.name ? ` ${konto.name}` : ""} …${iban.slice(-4)}`.slice(0, 100));
      if (!bekannt) neu.push(bankAccount.name);
      // Abrufstand nur aus einer früheren Vivid-Verbindung: Enable Banking und FinTS schreiben andere Tage und Zwecke
      const vorher = vorherige.find((a) => a.bankAccountId === bankAccount.id && a.uid === konto.id);
      accounts.push({
        uid: konto.id,
        iban,
        name: bankAccount.name,
        bankAccountId: bankAccount.id,
        syncedTo: vorher?.syncedTo ?? null,
        ...accountFetchFrom(vorher, data.fetchFrom ?? null),
      });
    }
    const beenden = await kontenUebernehmen(tx, new Set(accounts.map((a) => a.bankAccountId)));
    const [row] = await tx
      .insert(schema.vividConnections)
      .values({ ciphertext: encrypt(Buffer.from(data.apiKey, "utf8")), accounts })
      .returning({ id: schema.vividConnections.id });
    return { id: row!.id, beenden };
  });
  await zustimmungenBeenden(beenden);
  const ergebnis = await vividAbrufen(actor, id, now, "Vivid verbunden");
  const ohneIban = euro.length - abrufbar.length;
  return {
    ...ergebnis,
    hinweise: [
      ...[neuAngelegt(neu), ohneIban > 0 ? `${ohneIban} Konten ohne IBAN ruft Haben nicht ab.` : null, fremdwaehrung(fremd)].filter(
        (h): h is string => h !== null,
      ),
      ...ergebnis.hinweise,
    ],
  };
}

/** Verbindungen für die Bankseite, ohne Schlüssel */
export async function listVividConnections() {
  const rows = await db
    .select({
      id: schema.vividConnections.id,
      status: schema.vividConnections.status,
      accounts: schema.vividConnections.accounts,
      lastSyncAt: schema.vividConnections.lastSyncAt,
      lastError: schema.vividConnections.lastError,
      createdAt: schema.vividConnections.createdAt,
    })
    .from(schema.vividConnections)
    .orderBy(desc(schema.vividConnections.createdAt));
  const known = await db
    .select({ id: schema.bankAccounts.id, name: schema.bankAccounts.name, excludedAt: schema.bankAccounts.excludedAt })
    .from(schema.bankAccounts);
  const names = new Map(known.map((a) => [a.id, a.name]));
  const excluded = new Set(known.filter((a) => a.excludedAt).map((a) => a.id));
  return rows.map((r) => ({
    ...r,
    accounts: r.accounts.map((a) => ({ ...a, name: names.get(a.bankAccountId) ?? a.name, excluded: excluded.has(a.bankAccountId) })),
    lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Trennt eine Vivid-Verbindung: Der Schlüssel wird gelöscht, die Umsätze bleiben. In Vivid gilt er weiter, bis man ihn dort löscht. */
export async function removeVividConnection(actor: string, id: string): Promise<void> {
  const [row] = await withActor(actor, (tx) =>
    tx.delete(schema.vividConnections).where(eq(schema.vividConnections.id, id)).returning({ id: schema.vividConnections.id }),
  );
  if (!row) throw new BankError("Verbindung nicht gefunden.");
}
