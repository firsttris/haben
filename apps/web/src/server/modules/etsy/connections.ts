import { authorizationUrl, createEtsyClient, createPkce, exchangeCode, type EtsyClient, type EtsyClientOptions } from "@haben/import";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { env } from "../../env.ts";
import { UserError } from "../../errors.ts";
import { today } from "../../today.ts";
import { ETSY_RHYTHMEN, type EtsyRhythmus } from "./abruf-regeln.ts";

/*
 * Zugang zum Zahlungsverlauf von Etsy Payments (Einstellungen › Bank).
 *
 * Etsy kennt keinen Schlüssel, den man einfach einhängt: Der Verlauf gehört zu einem Shop, und der Zugang wird vom
 * Shop-Inhaber freigegeben (OAuth 2.0 mit PKCE). Deshalb zwei Schritte:
 *
 * 1. App-Schlüssel und gemeinsames Geheimnis der Etsy-App speichern. Die App legt jeder selbst an
 *    (https://www.etsy.com/developers/your-apps); die Rückleitung muss dort als Redirect-URI stehen.
 * 2. Verbinden: Haben schickt zum Freigeben zu Etsy, bekommt einen Code zurück und tauscht ihn gegen Zugangs- und
 *    Erneuerungstoken. Erst danach ist der Abruf möglich. Das Erneuerungstoken kommt bei jeder Erneuerung neu zurück
 *    und wird mitgespeichert.
 *
 * Das gemeinsame Geheimnis, die Token und die offene Anmeldung liegen AES-256-GCM-verschlüsselt in ciphertext; der
 * App-Schlüssel ist nicht geheim. Wird die Verbindung getrennt, bleiben Schlüssel und Geheimnis stehen, damit sie
 * ohne neue Eingabe wieder aufgenommen werden kann.
 *
 * Optional meldet Etsy jede bezahlte oder stornierte Bestellung an /api/etsy/webhook (webhook.ts); der Signaturschlüssel
 * dafür liegt ebenfalls in ciphertext.
 */

export class EtsyError extends UserError {}

/** Rechte des Abrufs: Verlauf und Bestellbezug (transactions_r), Shop-Kennung (shops_r) */
export const ETSY_SCOPES = "transactions_r shops_r";

/** Rückleitung nach der Freigabe bei Etsy; muss in der Etsy-App als Redirect-URI eingetragen sein */
export function etsyCallbackUrl(): string {
  return `${env().BETTER_AUTH_URL.replace(/\/+$/, "")}/api/etsy/callback`;
}

/** Empfangsadresse für die Webhooks von Etsy; gehört in der Etsy-App unter den Webhooks eingetragen */
export function etsyWebhookUrl(): string {
  return `${env().BETTER_AUTH_URL.replace(/\/+$/, "")}/api/etsy/webhook`;
}

/** Für Tests austauschbar: baut den API-Client */
let clientFactory = (options: EtsyClientOptions): EtsyClient => createEtsyClient(options);

export function setEtsyClientFactory(factory: (options: EtsyClientOptions) => EtsyClient) {
  clientFactory = factory;
}

/** Geheimnis und Token der Verbindung, verschlüsselt in ciphertext */
interface EtsySecret {
  sharedSecret: string;
  accessToken?: string;
  refreshToken?: string;
  /** Ablauf in Sekunden seit Epoch */
  expiresAt?: number;
  /** Offene Anmeldung: state und PKCE-Verifier, bis Etsy zurückleitet */
  pending?: { state: string; verifier: string; ts: number };
  /** Signaturschlüssel der Webhooks („whsec_…“ aus der Etsy-App); ohne ihn nimmt Haben keine Meldung an */
  webhookSecret?: string;
}

async function loadRow() {
  const [row] = await db.select().from(schema.etsyConnections).where(eq(schema.etsyConnections.id, "etsy"));
  return row ?? null;
}

function readSecret(row: { ciphertext: Buffer }): EtsySecret {
  const parsed = JSON.parse(decrypt(row.ciphertext).toString("utf8")) as Partial<EtsySecret>;
  return { ...parsed, sharedSecret: parsed.sharedSecret ?? "" };
}

export interface EtsyConnection {
  row: typeof schema.etsyConnections.$inferSelect;
  secret: EtsySecret;
}

export async function loadEtsyConnection(): Promise<EtsyConnection | null> {
  const row = await loadRow();
  if (!row) return null;
  return { row, secret: readSecret(row) };
}

/** Verbunden ist der Zugang erst mit Token; gespeicherter Schlüssel allein reicht nicht */
export async function etsyConnected(): Promise<boolean> {
  const connection = await loadEtsyConnection();
  return Boolean(connection?.secret.refreshToken && connection.row.shopId);
}

/** Client für einen Zugang; neue Token schreibt er über den Aufrufer zurück */
export function etsyClientFor(
  connection: EtsyConnection,
  onTokens?: (tokens: { accessToken: string; refreshToken: string; expiresAt: number }) => Promise<void>,
): EtsyClient {
  return clientFactory({
    keystring: connection.row.keystring,
    sharedSecret: connection.secret.sharedSecret,
    shopId: connection.row.shopId,
    tokens: {
      accessToken: connection.secret.accessToken ?? "",
      refreshToken: connection.secret.refreshToken ?? "",
      expiresAt: connection.secret.expiresAt ?? 0,
    },
    baseUrl: env().ETSY_API_URL,
    tokenUrl: env().ETSY_TOKEN_URL,
    onTokens,
  });
}

/** Schreibt Geheimnis und Token einer Verbindung; `ciphertext` wird dabei neu gebildet */
export async function storeEtsySecret(actor: string, secret: EtsySecret, values: Partial<typeof schema.etsyConnections.$inferInsert> = {}) {
  const data = { ...values, ciphertext: encrypt(new TextEncoder().encode(JSON.stringify(secret))), updatedAt: new Date() };
  await withActor(actor, (tx) =>
    tx
      .insert(schema.etsyConnections)
      .values({ id: "etsy", keystring: values.keystring ?? "", fetchFrom: values.fetchFrom ?? `${today().slice(0, 7)}-01`, ...data })
      .onConflictDoUpdate({ target: schema.etsyConnections.id, set: data }),
  );
}

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Monat als JJJJ-MM");

export const etsySettingsSchema = z.object({
  keystring: z.string().trim().min(1, "Der App-Schlüssel (keystring) fehlt.").max(200),
  /** leer: das gespeicherte Geheimnis behalten */
  sharedSecret: z.string().max(200).optional(),
  /** Erster Monat, den der Abruf holt */
  fetchFrom: month,
  /** Gebühren und Werbung je Monat zu einer Zeile bündeln */
  sammelzeilen: z.boolean().default(true),
  /** Wie oft der Zeitplan abruft */
  rhythmus: z.enum(ETSY_RHYTHMEN).default("taeglich"),
  /** Signaturschlüssel der Webhooks; leer: den gespeicherten behalten */
  webhookSecret: z.string().max(200).optional(),
});

/**
 * Speichert App-Schlüssel und Geheimnis. Ohne Geheimnis bleibt das gespeicherte stehen; wechselt der Schlüssel, werden
 * die Token verworfen, weil sie zu einer anderen App gehören.
 */
export async function saveEtsyConnection(actor: string, input: z.input<typeof etsySettingsSchema>): Promise<void> {
  const data = etsySettingsSchema.parse(input);
  const existing = await loadEtsyConnection();
  const sharedSecret = data.sharedSecret?.trim() || existing?.secret.sharedSecret || "";
  if (!sharedSecret) throw new EtsyError("Das gemeinsame Geheimnis der Etsy-App (shared secret) fehlt.");
  if (data.fetchFrom > today().slice(0, 7)) throw new EtsyError("Der erste Monat des Abrufs liegt in der Zukunft.");
  const gleicheApp = existing?.row.keystring === data.keystring;
  const webhookSecret = data.webhookSecret?.trim() || (gleicheApp ? existing?.secret.webhookSecret : undefined);
  const basis: EtsySecret = gleicheApp ? { ...existing!.secret, sharedSecret } : { sharedSecret };
  await storeEtsySecret(actor, webhookSecret ? { ...basis, webhookSecret } : basis, {
    keystring: data.keystring,
    fetchFrom: `${data.fetchFrom}-01`,
    abrufStart: `${data.fetchFrom}-01`,
    sammelzeilen: data.sammelzeilen,
    rhythmus: data.rhythmus,
    // Ein neuer Schlüssel gilt für eine andere App: Shop und Fehler gehören nicht mehr dazu
    ...(gleicheApp ? {} : { shopId: "", shopName: "", lastError: null }),
  });
}

/** Erste Adresse des Ablaufs: schickt den Browser zum Freigeben zu Etsy */
export async function startEtsyConnection(actor: string): Promise<string> {
  const connection = await loadEtsyConnection();
  if (!connection) throw new EtsyError("Erst den App-Schlüssel der Etsy-App speichern.");
  const { verifier, challenge } = createPkce();
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
  await storeEtsySecret(actor, { ...connection.secret, pending: { state, verifier, ts: Date.now() } });
  return authorizationUrl({
    keystring: connection.row.keystring,
    redirectUri: etsyCallbackUrl(),
    scopes: ETSY_SCOPES,
    state,
    codeChallenge: challenge,
    authUrl: env().ETSY_AUTH_URL,
  });
}

/** Rückleitung von Etsy: tauscht den Code gegen Token und ermittelt den Shop */
export async function completeEtsyConnection(
  actor: string,
  input: { state: string; code?: string; error?: string; errorDescription?: string },
): Promise<{ ok: boolean; message: string }> {
  const connection = await loadEtsyConnection();
  if (!connection) throw new EtsyError("Die Verbindung ist nicht eingerichtet.");
  const pending = connection.secret.pending;
  const fehlschlag = (text: string) => merkeFehler(actor, text);
  if (input.error) return fehlschlag(`Etsy meldet: ${input.errorDescription ?? input.error}`);
  if (!pending || pending.state !== input.state) return fehlschlag("Die Rückleitung von Etsy passt nicht zur offenen Anmeldung.");
  if (!input.code) return fehlschlag("In der Rückleitung von Etsy fehlt der Code.");
  // Eine Anmeldung gilt 15 Minuten; danach neu verbinden
  if (Date.now() - pending.ts > 15 * 60 * 1000) return fehlschlag("Die Anmeldung bei Etsy ist abgelaufen. Bitte erneut verbinden.");

  let tokens: { accessToken: string; refreshToken: string; expiresAt: number };
  try {
    tokens = await exchangeCode({
      keystring: connection.row.keystring,
      redirectUri: etsyCallbackUrl(),
      code: input.code,
      verifier: pending.verifier,
      tokenUrl: env().ETSY_TOKEN_URL,
    });
  } catch (error) {
    return fehlschlag(`Etsy nimmt die Freigabe nicht an: ${message(error)}`);
  }
  const secret: EtsySecret = { ...connection.secret, ...tokens };
  delete secret.pending;
  // Die Freigabe zuerst sichern: schlägt die Shop-Abfrage fehl, muss nicht neu freigegeben werden
  await storeEtsySecret(actor, secret, { lastError: null });
  const client = etsyClientFor({ row: connection.row, secret });
  let shop: { shopId: string; shopName: string };
  try {
    shop = await client.shop();
  } catch (error) {
    return fehlschlag(`Freigegeben, aber der Shop ließ sich nicht ermitteln: ${message(error)}`);
  }
  await storeEtsySecret(actor, secret, { shopId: shop.shopId, shopName: shop.shopName, lastError: null });
  return { ok: true, message: `Verbunden mit ${shop.shopName || "dem Shop"} (${shop.shopId}).` };
}

/** Trennt die Verbindung: Token weg, Schlüssel und Geheimnis bleiben für einen neuen Anlauf */
export async function disconnectEtsyConnection(actor: string): Promise<void> {
  const connection = await loadEtsyConnection();
  if (!connection) return;
  const { sharedSecret, webhookSecret } = connection.secret;
  await storeEtsySecret(actor, webhookSecret ? { sharedSecret, webhookSecret } : { sharedSecret }, { shopId: "", shopName: "", lastError: null });
}

/** Entfernt den Zugang ganz; importierte Umsätze bleiben im Konto stehen */
export async function deleteEtsyConnection(actor: string): Promise<void> {
  await withActor(actor, (tx) => tx.delete(schema.etsyConnections).where(eq(schema.etsyConnections.id, "etsy")));
}

/** Für die Einstellungen: Stand ohne Geheimnis und ohne Token */
export async function etsySummary() {
  const connection = await loadEtsyConnection();
  return {
    callbackUrl: etsyCallbackUrl(),
    webhookUrl: etsyWebhookUrl(),
    webhookConfigured: Boolean(connection?.secret.webhookSecret),
    scopes: ETSY_SCOPES,
    configured: connection !== null,
    connected: Boolean(connection?.secret.refreshToken && connection.row.shopId),
    keystring: connection?.row.keystring ?? "",
    shopId: connection?.row.shopId ?? "",
    shopName: connection?.row.shopName ?? "",
    // Die Wahl aus den Einstellungen, nicht der vorrückende Stand des Abrufs (der steht in naechsterAbrufAb)
    fetchFrom: (connection?.row.abrufStart ?? connection?.row.fetchFrom)?.slice(0, 7) ?? today().slice(0, 7),
    naechsterAbrufAb: connection?.row.fetchFrom ?? null,
    sammelzeilen: connection?.row.sammelzeilen ?? true,
    rhythmus: (connection?.row.rhythmus ?? "taeglich") as EtsyRhythmus,
    lastSyncAt: connection?.row.lastSyncAt ?? null,
    lastError: connection?.row.lastError ?? null,
    updatedAt: connection?.row.updatedAt ?? null,
  };
}

/**
 * Merkt eine gescheiterte Freigabe am Zugang. Die Rückleitung schickt den Browser nur zurück in die
 * Einstellungen, deshalb wäre die Meldung sonst verloren und die Karte bliebe stumm.
 */
async function merkeFehler(actor: string, text: string): Promise<{ ok: false; message: string }> {
  await withActor(actor, (tx) =>
    tx.update(schema.etsyConnections).set({ lastError: text, updatedAt: new Date() }).where(eq(schema.etsyConnections.id, "etsy")),
  );
  return { ok: false, message: text };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
