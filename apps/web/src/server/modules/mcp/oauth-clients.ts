import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, count, eq, lt, notExists } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { allowedRedirectUri } from "./oauth-redirect.ts";

/*
 * Dynamic Client Registration (RFC 7591) für die Connectors in claude.ai. Jeder darf einen Client anmelden; Zugriff bekommt
 * er erst, wenn der Inhaber in Haben zustimmt. Damit die offene Registrierung nichts Fremdes öffnet, nimmt Haben nur
 * Redirect-URIs von Claude und Loopback-Adressen (lokale Clients, RFC 8252) an und räumt Clients ohne Verbindung auf.
 */

/** Ein Client ohne Verbindung fällt nach einem Tag weg */
const UNUSED_CLIENT_MS = 86_400_000;
/** Höchstens so viele Clients ohne Verbindung auf einmal, gegen Füllen der Datenbank */
const MAX_UNUSED_CLIENTS = 50;

/** Client ohne Zeile in mcp_tokens; mit Verbindung bleibt er für Protokoll und Widerruf erhalten */
const withoutConnection = () =>
  notExists(db.select({ id: schema.mcpTokens.id }).from(schema.mcpTokens).where(eq(schema.mcpTokens.oauthClientId, schema.mcpOauthClients.id)));

export const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;

export class OAuthError extends UserError {
  constructor(
    readonly code: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

export const hashSecret = (value: string) => createHash("sha256").update(value).digest("hex");

const registrationSchema = z.object({
  redirect_uris: z.array(z.string().max(500)).min(1).max(5),
  client_name: z.string().max(200).optional(),
  // Vorgabe nach RFC 7591 ist client_secret_basic
  token_endpoint_auth_method: z.enum(AUTH_METHODS).default("client_secret_basic"),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).optional(),
  response_types: z.array(z.literal("code")).optional(),
});

/** Legt einen Client an. Die Antwort enthält das Client-Secret im Klartext; gespeichert ist nur sein Hash. */
export async function registerClient(body: unknown, now = new Date()) {
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) throw new OAuthError("invalid_client_metadata", "Die Angaben zum Client sind unvollständig oder ungültig.");
  const input = parsed.data;
  if (!input.redirect_uris.every(allowedRedirectUri))
    throw new OAuthError("invalid_redirect_uri", "Erlaubt sind nur Redirect-URIs von claude.ai, claude.com und Loopback-Adressen.");

  // Erst Clients ohne Verbindung älter als einen Tag löschen, dann die übrigen ohne Verbindung zählen
  await db.delete(schema.mcpOauthClients).where(and(withoutConnection(), lt(schema.mcpOauthClients.createdAt, new Date(now.getTime() - UNUSED_CLIENT_MS))));
  const [open] = await db.select({ n: count() }).from(schema.mcpOauthClients).where(withoutConnection());
  if ((open?.n ?? 0) >= MAX_UNUSED_CLIENTS)
    throw new OAuthError("temporarily_unavailable", "Zu viele offene Registrierungen, bitte später erneut versuchen.", 429);

  const clientId = randomBytes(16).toString("base64url");
  const secret = input.token_endpoint_auth_method === "none" ? null : randomBytes(32).toString("base64url");
  const name = (input.client_name ?? "").trim().slice(0, 80) || "OAuth-Client";
  await db.insert(schema.mcpOauthClients).values({
    clientId,
    secretHash: secret ? hashSecret(secret) : null,
    name,
    redirectUris: input.redirect_uris,
    createdAt: now,
  });
  return {
    client_id: clientId,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: name,
    redirect_uris: input.redirect_uris,
    token_endpoint_auth_method: input.token_endpoint_auth_method,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}

export type OAuthClient = typeof schema.mcpOauthClients.$inferSelect;

export async function findClient(clientId: string): Promise<OAuthClient | undefined> {
  const [client] = await db.select().from(schema.mcpOauthClients).where(eq(schema.mcpOauthClients.clientId, clientId));
  return client;
}

/**
 * Client am Token-Endpunkt: client_id aus dem Body oder per Basic-Header (RFC 6749, 2.3.1). Ein Client mit Secret muss es
 * mitschicken, ein öffentlicher nicht; PKCE schützt ihn.
 */
export async function authenticateClient(request: Request, form: URLSearchParams): Promise<OAuthClient> {
  let clientId = form.get("client_id");
  let secret = form.get("client_secret");
  const basic = /^Basic\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (basic) {
    const decoded = Buffer.from(basic[1]!, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon < 0) throw new OAuthError("invalid_client", "Client-Anmeldung ungültig.", 401);
    clientId = decodeURIComponent(decoded.slice(0, colon));
    secret = decodeURIComponent(decoded.slice(colon + 1));
  }
  const client = clientId ? await findClient(clientId) : undefined;
  if (!client) throw new OAuthError("invalid_client", "Client unbekannt.", 401);
  if (client.secretHash) {
    const given = Buffer.from(hashSecret(secret ?? ""), "hex");
    if (!secret || !timingSafeEqual(given, Buffer.from(client.secretHash, "hex"))) throw new OAuthError("invalid_client", "Client-Anmeldung ungültig.", 401);
  }
  return client;
}
