import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "./db/index.ts";
import { env } from "./env.ts";
import { UserError } from "./errors.ts";
import { ssoOnly } from "./sso-policy.ts";

/** Derselbe Lock bei Rollenentzug, Tokenanlage und Übernahme; immer vor Token-Zeilensperren. */
export async function lockTokenResponsibility(tx: Tx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`haben:token-owner:${userId}`}, 0))`);
}

/** Die Middleware prüft die Sitzung; diese zweite Prüfung schützt vor gleichzeitigem Rollenentzug. */
export async function requireTokenOwner(tx: Tx, actor: string) {
  await lockTokenResponsibility(tx, actor);
  const [user] = await tx.select().from(schema.user).where(eq(schema.user.id, actor));
  if (!user) throw new UserError("Nur ein aktuell berechtigter Inhaber darf Tokens verwalten.");
  if (!ssoOnly()) {
    if (user.role === "inhaber" && !user.lockedAt) return;
  } else {
    const [role] = await tx
      .select()
      .from(schema.ssoRoles)
      .where(and(eq(schema.ssoRoles.userId, actor), eq(schema.ssoRoles.issuer, env().OIDC_ISSUER!)));
    if (role?.role === "inhaber" && role.confirmedAt.getTime() > Date.now() - 15 * 60_000) return;
  }
  throw new UserError("Nur ein aktuell berechtigter Inhaber darf Tokens verwalten.");
}

export async function tokenEvent(
  tx: Tx,
  actor: string,
  kind: "api" | "kalender",
  tokenId: string,
  action: string,
  responsibleId: string | null,
  previousResponsibleId: string | null = null,
) {
  await tx.insert(schema.tokenEvents).values({ actor, kind, tokenId, action, responsibleId, previousResponsibleId });
}

/** Innerhalb derselben Transaktion wie die geprüfte negative Rollenentscheidung. Geheimnisse bleiben erhalten. */
export async function disableResponsibleTokens(tx: Tx, userId: string) {
  await lockTokenResponsibility(tx, userId);
  const tokens = await tx
    .update(schema.mcpTokens)
    .set({ disabledAt: new Date(), disabledReason: "inhaberrolle-entzogen" })
    .where(and(eq(schema.mcpTokens.responsibleId, userId), isNull(schema.mcpTokens.disabledAt), isNull(schema.mcpTokens.revokedAt)))
    .returning({ id: schema.mcpTokens.id });
  for (const token of tokens) await tokenEvent(tx, "system:oidc", "api", token.id, "deaktiviert", userId);
  const calendars = await tx
    .update(schema.company)
    .set({ calendarTokenDisabledAt: new Date(), calendarTokenDisabledReason: "inhaberrolle-entzogen" })
    .where(
      and(
        eq(schema.company.calendarTokenResponsibleId, userId),
        isNull(schema.company.calendarTokenDisabledAt),
        sql`${schema.company.calendarTokenHash} is not null`,
      ),
    )
    .returning({ id: schema.company.id });
  for (const calendar of calendars) await tokenEvent(tx, "system:oidc", "kalender", String(calendar.id), "deaktiviert", userId);
}
