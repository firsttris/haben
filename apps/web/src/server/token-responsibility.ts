import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "./db/index.ts";
import { env } from "./env.ts";
import { UserError } from "./errors.ts";
import { SSO_PROOF_MS } from "./sso-groups.ts";
import { ssoOnly } from "./sso-policy.ts";

/**
 * So lange trägt die letzte SSO-Bestätigung des Verantwortlichen dessen Tokens. Einen Gruppenentzug sieht Haben nur beim
 * Callback; wer nie wiederkommt, soll Tokens nicht bis zu ihrem Ablauf (bis 365 Tage) am Leben halten.
 */
export const TOKEN_OWNER_CONFIRMATION_MS = 30 * 86_400_000;

/**
 * Konten, die in der laufenden Betriebsart Tokens verantworten können: lokal ungesperrte Inhaber, im SSO-Modus Inhaber mit
 * Bestätigung dieses Issuers innerhalb der Frist. Tokens anderer Konten gelten nicht, auch nach einem Moduswechsel.
 */
export async function currentTokenOwners(q: Pick<Tx, "select">, now = new Date()): Promise<Set<string>> {
  const rows = ssoOnly()
    ? await q
        .select({ id: schema.ssoRoles.userId })
        .from(schema.ssoRoles)
        .where(
          and(
            eq(schema.ssoRoles.issuer, env().OIDC_ISSUER!),
            eq(schema.ssoRoles.role, "inhaber"),
            gt(schema.ssoRoles.confirmedAt, new Date(now.getTime() - TOKEN_OWNER_CONFIRMATION_MS)),
          ),
        )
    : await q
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(and(eq(schema.user.role, "inhaber"), isNull(schema.user.lockedAt)));
  return new Set(rows.map((row) => row.id));
}

/**
 * Warum `actor` einen Zugang nicht übernehmen darf, oder null. Übernehmen lässt sich nur, was deaktiviert ist oder keinen
 * gültigen Verantwortlichen hat. Den eigenen Zugang übernimmt ein anderer Inhaber; nur wer der einzige ist, darf es selbst,
 * sonst blieben seine Tokens nach einer vorübergehenden Abweisung für immer tot.
 */
export function takeoverProblem(owners: Set<string>, actor: string, responsibleId: string | null, disabled: boolean): string | null {
  if (!disabled && responsibleId && owners.has(responsibleId)) return "Nur ein deaktivierter oder unbestätigter, noch gültiger Zugang lässt sich übernehmen.";
  if (responsibleId === actor && [...owners].some((id) => id !== actor)) return "Ein anderer Inhaber muss diesen Zugang übernehmen.";
  return null;
}

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
    if (role?.role === "inhaber" && role.confirmedAt.getTime() > Date.now() - SSO_PROOF_MS) return;
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
