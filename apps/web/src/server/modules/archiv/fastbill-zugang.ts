import { FastbillClient, type FastbillClientOptions } from "@haben/import";
import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { env } from "../../env.ts";
import { UserError } from "../../errors.ts";
import { progressMessage } from "./lexoffice.ts";

/* Zugang zur FastBill-API: Login-E-Mail, verschlüsselter API-Schlüssel und Tarif mit seiner Stundengrenze. */

export class FastbillError extends UserError {}

/** Für Tests austauschbar: baut den API-Client */
let clientFactory = (options: FastbillClientOptions) => new FastbillClient({ url: env().FASTBILL_API_URL || undefined, ...options });

export function setFastbillClientFactory(factory: (options: FastbillClientOptions) => FastbillClient) {
  clientFactory = factory;
}

/** Stundengrenzen der Tarife laut API-Doku (https://apidocs.fastbill.com/fastbill/en/fundamentals.html) */
export const FASTBILL_PLANS = [
  { callsPerHour: 50, label: "Solo" },
  { callsPerHour: 100, label: "Solo-Plus" },
  { callsPerHour: 500, label: "Pro" },
  { callsPerHour: 1000, label: "Premium" },
] as const;

export async function fastbillCredentials(): Promise<{ email: string; apiKey: string; callsPerHour: number } | null> {
  const [row] = await db.select().from(schema.fastbillConnection).where(eq(schema.fastbillConnection.id, 1));
  return row ? { email: row.email, apiKey: decrypt(row.ciphertext).toString("utf8"), callsPerHour: row.callsPerHour } : null;
}

export async function fastbillConnectionStatus() {
  const [row] = await db
    .select({ email: schema.fastbillConnection.email, callsPerHour: schema.fastbillConnection.callsPerHour, createdAt: schema.fastbillConnection.createdAt })
    .from(schema.fastbillConnection)
    .where(eq(schema.fastbillConnection.id, 1));
  return row ?? null;
}

/** Prüft E-Mail und Schlüssel mit einem Aufruf und speichert den Schlüssel verschlüsselt. */
export async function saveFastbillKey(actor: string, input: { email: string; apiKey: string; callsPerHour: number }): Promise<{ email: string }> {
  const email = input.email.trim();
  const apiKey = input.apiKey.trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new FastbillError("Die Login-E-Mail von FastBill fehlt oder ist ungültig.");
  if (apiKey.length < 20) throw new FastbillError("Der API-Schlüssel ist zu kurz.");
  if (!FASTBILL_PLANS.some((p) => p.callsPerHour === input.callsPerHour)) throw new FastbillError("Unbekannter Tarif.");
  try {
    await clientFactory({ email, apiKey, callsPerHour: input.callsPerHour }).verify();
  } catch (error) {
    throw new FastbillError(`FastBill lehnt die Anmeldung ab: ${progressMessage(error)}`);
  }
  await withActor(actor, async (tx) => {
    await tx.delete(schema.fastbillConnection).where(eq(schema.fastbillConnection.id, 1));
    await tx.insert(schema.fastbillConnection).values({ id: 1, email, ciphertext: encrypt(Buffer.from(apiKey, "utf8")), callsPerHour: input.callsPerHour });
  });
  return { email };
}

export async function removeFastbillKey(actor: string) {
  await withActor(actor, (tx) => tx.delete(schema.fastbillConnection).where(eq(schema.fastbillConnection.id, 1)));
}

/** Baut den API-Client, in Tests über setFastbillClientFactory ersetzbar */
export function newFastbillClient(options: FastbillClientOptions): FastbillClient {
  return clientFactory(options);
}
