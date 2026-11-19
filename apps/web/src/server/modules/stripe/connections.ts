import { StripeClient, type StripeClientOptions } from "@haben/import";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { env } from "../../env.ts";
import { UserError } from "../../errors.ts";
import { today } from "../../today.ts";
import { openConflicts } from "../bank/index.ts";
import { STRIPE_RHYTHMEN, type StripeRhythmus } from "./abruf-regeln.ts";

/*
 * Zugang zu den Balance Transactions von Stripe (Einstellungen › Bank, #1280).
 *
 * Stripe kennt für den lesenden Zugriff einen API-Schlüssel, den der Betreiber im Dashboard anlegt (Entwickler › API-Schlüssel
 * › „Eingeschränkten Schlüssel erstellen“ mit Lesezugriff auf „Guthaben“ und „Konto“; ein geheimer Schlüssel geht auch,
 * gibt Haben aber mehr Rechte als nötig). Beim Speichern fragt Haben Stripe nach dem Konto (`GET /v1/account`): Das prüft
 * den Schlüssel und liefert die Kennung `acct_…`, unter der die Quellenbindung läuft. Der Schlüssel liegt AES-256-GCM-
 * verschlüsselt in ciphertext, nie im Klartext in der Datenbank, im Protokoll oder in einer Meldung.
 */

export class StripeError extends UserError {}

/** Für Tests austauschbar: baut den API-Client */
let clientFactory = (options: StripeClientOptions): StripeClient => new StripeClient(options);

export function setStripeClientFactory(factory: (options: StripeClientOptions) => StripeClient) {
  clientFactory = factory;
}

/** Client für einen Schlüssel */
export function stripeClientFor(apiKey: string): StripeClient {
  return clientFactory({ apiKey, baseUrl: env().STRIPE_API_URL });
}

async function loadRow() {
  const [row] = await db.select().from(schema.stripeConnections).where(eq(schema.stripeConnections.id, "stripe"));
  return row ?? null;
}

export interface StripeConnection {
  row: typeof schema.stripeConnections.$inferSelect;
  apiKey: string;
}

export async function loadStripeConnection(): Promise<StripeConnection | null> {
  const row = await loadRow();
  if (!row) return null;
  return { row, apiKey: decrypt(row.ciphertext).toString("utf8") };
}

const KEY = /^(rk|sk)_live_[A-Za-z0-9]{8,}$/;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tag als JJJJ-MM-TT");

export const stripeSettingsSchema = z.object({
  /** leer: den gespeicherten Schlüssel behalten */
  apiKey: z.string().trim().max(300).optional(),
  /** Erster Tag, den der Abruf holt */
  fetchFrom: day,
  /** Wie oft der Zeitplan abruft */
  rhythmus: z.enum(STRIPE_RHYTHMEN).default("taeglich"),
});

/** Meldung zu einem Fehler von Stripe beim Prüfen des Schlüssels; ohne den Schlüssel selbst */
function pruefFehler(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return `Stripe nimmt den Schlüssel nicht an: ${text}`;
}

/**
 * Speichert Schlüssel und Einstellungen. Ein neuer Schlüssel wird gegen Stripe geprüft und liefert die Kontokennung; gehört er
 * zu einem anderen Konto, beginnt der Abruf wieder am gewählten Tag, weil der Stand des alten Kontos nichts über das neue sagt.
 */
export async function saveStripeConnection(actor: string, input: z.input<typeof stripeSettingsSchema>): Promise<void> {
  const data = stripeSettingsSchema.parse(input);
  if (data.fetchFrom > today()) throw new StripeError("Der erste Tag des Abrufs liegt in der Zukunft.");
  const existing = await loadStripeConnection();
  const newKey = data.apiKey?.trim();
  if (!newKey && !existing) throw new StripeError("Der API-Schlüssel von Stripe fehlt.");
  let accountId = existing?.row.accountId ?? "";
  let apiKey = existing?.apiKey ?? "";
  if (newKey) {
    // Testdaten kämen sonst ins Konto des Zahlungsdienstleisters und in den Bankabgleich (Entscheidung des Maintainers in #1237)
    if (/^(rk|sk)_test_/.test(newKey)) {
      throw new StripeError("Haben ruft nur Live-Umsätze ab; bitte einen Live-Schlüssel mit Leserechten eintragen.");
    }
    if (!KEY.test(newKey)) {
      throw new StripeError("Das ist kein API-Schlüssel von Stripe (er beginnt mit rk_live_ oder sk_live_). Der öffentliche Schlüssel pk_ reicht nicht.");
    }
    try {
      accountId = await stripeClientFor(newKey).accountId();
    } catch (error) {
      throw new StripeError(pruefFehler(error));
    }
    apiKey = newKey;
  }
  const anderesKonto = existing !== null && existing.row.accountId !== accountId;
  const startGeaendert = existing?.row.abrufStart !== data.fetchFrom;
  const values = {
    accountId,
    keyHint: apiKey.slice(-4),
    ciphertext: encrypt(new TextEncoder().encode(apiKey)),
    abrufStart: data.fetchFrom,
    rhythmus: data.rhythmus,
    // Ein anderer Start oder ein anderes Konto beginnt wieder am gewählten Tag
    fetchFrom: anderesKonto || startGeaendert || !existing ? data.fetchFrom : existing.row.fetchFrom,
    ...(anderesKonto || newKey ? { lastError: null } : {}),
    updatedAt: new Date(),
  };
  await withActor(actor, (tx) =>
    tx
      .insert(schema.stripeConnections)
      .values({ id: "stripe", ...values })
      .onConflictDoUpdate({ target: schema.stripeConnections.id, set: values }),
  );
}

/** Entfernt den Zugang ganz; übernommene Umsätze bleiben im Konto stehen */
export async function deleteStripeConnection(actor: string): Promise<void> {
  await withActor(actor, (tx) => tx.delete(schema.stripeConnections).where(eq(schema.stripeConnections.id, "stripe")));
}

/** Für die Einstellungen: Stand ohne den Schlüssel */
export async function stripeSummary() {
  const row = await loadRow();
  return {
    configured: row !== null,
    accountId: row?.accountId ?? "",
    keyHint: row?.keyHint ?? "",
    // Die Wahl aus den Einstellungen, nicht der vorrückende Stand des Abrufs (der steht in naechsterAbrufAb)
    fetchFrom: row?.abrufStart ?? today(),
    naechsterAbrufAb: row?.fetchFrom ?? null,
    rhythmus: (row?.rhythmus ?? "taeglich") as StripeRhythmus,
    lastSyncAt: row?.lastSyncAt ?? null,
    lastError: row?.lastError ?? null,
    updatedAt: row?.updatedAt ?? null,
    /** Offene Konflikte des Abrufs (#306): Bis sie geklärt sind, übernimmt Haben aus dem Stripe-Abruf nichts */
    konflikte: (await openConflicts()).filter((k) => k.provider === "stripe"),
  };
}
