import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { loadCompany } from "../stammdaten/index.ts";

/*
 * API-Tokens für KI-Assistenten über MCP (/api/mcp) und für die REST-API (/api/v1, #199). Lokale Clients (Claude Code,
 * Claude Desktop mit eigener Konfiguration, lokale Modelle, n8n) schicken ein API-Token als Bearer-Header. Gespeichert
 * ist nur der Hash; das Token gibt es nur beim Anlegen. Eine Token-Verwaltung für beide Wege: was ein Token darf, sagen
 * allein seine Rechte (scopes), ein Schalter in den Firmendaten sperrt alle auf einmal.
 *
 * Alles hinter /api/mcp und /api/v1 kennt nur das Ergebnis von authenticateMcp (Zugang mit Rechten), nicht die Art der
 * Anmeldung. Kommt später OAuth für die Connectors aus claude.ai dazu, wird nur diese Funktion erweitert.
 */

export class McpError extends UserError {}

/**
 * Rechte eines Tokens. haben:lesen gilt für die Werkzeuge über MCP, die übrigen für die REST-API. Kein Recht bucht,
 * schreibt fest oder versendet; das bleibt wegen GoBD ein Klick in Haben.
 */
export const TOKEN_SCOPES = ["haben:lesen", "kontakte:lesen", "kontakte:schreiben", "rechnungen:lesen", "rechnungen:entwuerfe"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** Beschreibung je Recht für Einstellungen und OpenAPI */
export const TOKEN_SCOPE_LABELS: Record<TokenScope, string> = {
  "haben:lesen": "KI-Assistent (MCP): Buchhaltung lesen",
  "kontakte:lesen": "API: Kontakte lesen",
  "kontakte:schreiben": "API: Kontakte lesen, anlegen und ändern",
  "rechnungen:lesen": "API: Rechnungen und Entwürfe lesen",
  "rechnungen:entwuerfe": "API: Rechnungen lesen, Entwürfe anlegen, ändern und löschen",
};

/** Ein Recht schließt ein anderes mit ein: wer schreiben darf, darf auch lesen */
const IMPLIED: Partial<Record<TokenScope, TokenScope>> = { "kontakte:schreiben": "kontakte:lesen", "rechnungen:entwuerfe": "rechnungen:lesen" };

export function hasScope(granted: readonly TokenScope[], needed: TokenScope): boolean {
  return granted.some((scope) => scope === needed || IMPLIED[scope] === needed);
}

/** Gültigkeit eines neuen Tokens in Tagen */
export const MCP_TOKEN_DAYS = [30, 90, 365] as const;

const TOKEN_PREFIX = "hb_";
/** Protokoll der Aufrufe so lange aufheben */
const CALL_RETENTION_DAYS = 90;

export const mcpTokenInputSchema = z.object({
  name: z.string().trim().min(1, "Bitte einen Namen angeben.").max(80),
  days: z.union([z.literal(30), z.literal(90), z.literal(365)]),
  /** Ohne Angabe wie vor der REST-API: nur der KI-Assistent liest */
  scopes: z
    .array(z.enum(TOKEN_SCOPES))
    .min(1, "Bitte mindestens ein Recht wählen.")
    .default(["haben:lesen"])
    .transform((scopes) => TOKEN_SCOPES.filter((scope) => scopes.includes(scope))),
});

export interface McpAccess {
  tokenId: string;
  /** Name des Zugangs, für Protokoll und Anzeige */
  clientName: string;
  scopes: TokenScope[];
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function mcpEnabled(): Promise<boolean> {
  return (await loadCompany()).mcpEnabled;
}

export async function setMcpEnabled(actor: string, enabled: boolean): Promise<void> {
  await loadCompany();
  await withActor(actor, (tx) => tx.update(schema.company).set({ mcpEnabled: enabled, updatedAt: new Date() }).where(eq(schema.company.id, 1)));
}

/** Legt ein Token an; den Klartext gibt es nur in dieser Antwort. */
export async function createMcpToken(input: z.input<typeof mcpTokenInputSchema>, now = new Date()): Promise<{ id: string; token: string }> {
  const { name, days, scopes } = mcpTokenInputSchema.parse(input);
  if (!(await mcpEnabled())) throw new McpError("Erst den Zugang für KI-Assistenten und API einschalten.");
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const [row] = await db
    .insert(schema.mcpTokens)
    .values({
      name,
      tokenHash: hashToken(token),
      prefix: token.slice(0, TOKEN_PREFIX.length + 4),
      scopes,
      createdAt: now,
      expiresAt: new Date(now.getTime() + days * 86_400_000),
    })
    .returning({ id: schema.mcpTokens.id });
  return { id: row!.id, token };
}

export async function revokeMcpToken(id: string, now = new Date()): Promise<void> {
  await db
    .update(schema.mcpTokens)
    .set({ revokedAt: now })
    .where(and(eq(schema.mcpTokens.id, id), isNull(schema.mcpTokens.revokedAt)));
}

/** Alle Zugänge, gültige zuerst; widerrufene und abgelaufene bleiben zur Nachvollziehbarkeit sichtbar */
export async function listMcpTokens(now = new Date()) {
  const rows = await db
    .select({
      id: schema.mcpTokens.id,
      name: schema.mcpTokens.name,
      prefix: schema.mcpTokens.prefix,
      scopes: schema.mcpTokens.scopes,
      createdAt: schema.mcpTokens.createdAt,
      expiresAt: schema.mcpTokens.expiresAt,
      lastUsedAt: schema.mcpTokens.lastUsedAt,
      revokedAt: schema.mcpTokens.revokedAt,
    })
    .from(schema.mcpTokens)
    .orderBy(desc(schema.mcpTokens.createdAt));
  return rows
    .map((row) => ({ ...row, status: row.revokedAt ? ("widerrufen" as const) : row.expiresAt <= now ? ("abgelaufen" as const) : ("aktiv" as const) }))
    .sort((a, b) => Number(a.status !== "aktiv") - Number(b.status !== "aktiv"));
}

/**
 * Prüft den Bearer-Header einer Anfrage an /api/mcp oder /api/v1. Null, wenn der Zugang ausgeschaltet ist oder das Token fehlt,
 * unbekannt, abgelaufen oder widerrufen ist.
 */
export async function authenticateMcp(request: Request, now = new Date()): Promise<McpAccess | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match || !match[1]!.startsWith(TOKEN_PREFIX)) return null;
  if (!(await mcpEnabled())) return null;
  // Gesucht wird über den Hash; ein Vergleich in konstanter Zeit ist damit nicht nötig
  const [row] = await db
    .select({ id: schema.mcpTokens.id, name: schema.mcpTokens.name, scopes: schema.mcpTokens.scopes })
    .from(schema.mcpTokens)
    .where(and(eq(schema.mcpTokens.tokenHash, hashToken(match[1]!)), isNull(schema.mcpTokens.revokedAt), gt(schema.mcpTokens.expiresAt, now)));
  if (!row) return null;
  await db.update(schema.mcpTokens).set({ lastUsedAt: now }).where(eq(schema.mcpTokens.id, row.id));
  return { tokenId: row.id, clientName: row.name, scopes: row.scopes.filter((s): s is TokenScope => (TOKEN_SCOPES as readonly string[]).includes(s)) };
}

/** Ein Werkzeug- oder API-Aufruf ins Protokoll, ohne Eingaben und Ergebnis; Älteres als 90 Tage fällt dabei weg */
export async function recordMcpCall(access: McpAccess, tool: string, ok: boolean, durationMs: number, now = new Date()): Promise<void> {
  await db.insert(schema.mcpCalls).values({ at: now, tokenId: access.tokenId, tool, ok, durationMs: Math.round(durationMs) });
  await db.delete(schema.mcpCalls).where(lt(schema.mcpCalls.at, new Date(now.getTime() - CALL_RETENTION_DAYS * 86_400_000)));
}

/** Letzte Werkzeugaufrufe für die Einstellungen */
export async function recentMcpCalls(limit = 20) {
  return db
    .select({
      id: schema.mcpCalls.id,
      at: schema.mcpCalls.at,
      tool: schema.mcpCalls.tool,
      ok: schema.mcpCalls.ok,
      durationMs: schema.mcpCalls.durationMs,
      client: schema.mcpTokens.name,
    })
    .from(schema.mcpCalls)
    .innerJoin(schema.mcpTokens, eq(schema.mcpTokens.id, schema.mcpCalls.tokenId))
    .orderBy(desc(schema.mcpCalls.at), desc(schema.mcpCalls.id))
    .limit(limit);
}
