import { disableResponsibleTokens, lockTokenResponsibility } from "./token-responsibility.ts";
import { APIError } from "better-auth";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Rolle } from "../lib/rollen.ts";
import { authTransaction, callbackProof, rejectCallback, type SsoProof } from "./auth-transaction.ts";
import { withActor } from "./db/actor.ts";
import { schema, type Tx } from "./db/index.ts";

/*
 * Datenbankseite eines SSO-Callbacks: Einrichtung festhalten, Rolle bestätigen, Sitzungen widerrufen. Läuft in der
 * Transaktion von atomicAuthCallback, damit Konto, Zuordnung, Rolle und Sitzung gemeinsam entstehen oder gar nicht.
 */

const refuse = (message: string) => new APIError("FORBIDDEN", { message });

/** Der geprüfte Nachweis mit Rolle und die Callback-Transaktion; ohne beides entsteht im SSO-Modus nichts */
export function requireGrantedProof(): { proof: SsoProof & { role: Rolle; expiresAt: Date }; tx: Tx } {
  const proof = callbackProof();
  const tx = authTransaction();
  if (!proof?.role || !proof.expiresAt || !tx) throw refuse("Die SSO-Anmeldung ist ungültig.");
  return { proof: proof as SsoProof & { role: Rolle; expiresAt: Date }, tx };
}

/** Ob die Instanz für diesen Issuer schon über SSO eingerichtet ist */
export async function ssoInitialized(q: Pick<Tx, "select">, issuer: string): Promise<boolean> {
  const [row] = await q.select({ issuer: schema.ssoIssuers.issuer }).from(schema.ssoIssuers).where(eq(schema.ssoIssuers.issuer, issuer));
  return !!row;
}

/**
 * Bestätigt die Rolle für die neue Sitzung: die Identität gehört genau zu diesem Konto, die erste Einrichtung macht nur
 * ein Inhaber, und ändert sich die Rolle, enden alle bisherigen Sitzungen des Kontos. Gibt die Sitzungsfelder zurück.
 */
export async function confirmSsoSession(userId: string) {
  const { proof, tx } = requireGrantedProof();
  const [identity] = await tx
    .select({ userId: schema.account.userId })
    .from(schema.account)
    .where(and(eq(schema.account.providerId, "oidc"), eq(schema.account.accountId, proof.accountId)));
  if (identity?.userId !== userId) throw refuse("Die SSO-Identität gehört nicht zu diesem Konto.");

  // Mehrere Inhaber dürfen gleichzeitig einrichten; der Eintrag entsteht einmal, die anderen finden ihn vor
  if (!(await ssoInitialized(tx, proof.issuer))) {
    if (proof.role !== "inhaber") {
      rejectCallback("nicht-eingerichtet");
      throw refuse("Haben ist noch nicht eingerichtet; das erledigt ein Inhaber.");
    }
    await tx.insert(schema.ssoIssuers).values({ issuer: proof.issuer, initializedBy: userId }).onConflictDoNothing();
  }

  await lockTokenResponsibility(tx, userId);
  const [previous] = await tx
    .select({ role: schema.ssoRoles.role, confirmedAt: schema.ssoRoles.confirmedAt })
    .from(schema.ssoRoles)
    .where(and(eq(schema.ssoRoles.userId, userId), eq(schema.ssoRoles.issuer, proof.issuer)))
    .for("update");
  if (previous && (previous.confirmedAt > proof.checkedAt || (previous.confirmedAt.getTime() === proof.checkedAt.getTime() && previous.role !== proof.role))) {
    throw refuse("Die SSO-Berechtigungen wurden inzwischen erneut geprüft. Bitte neu anmelden.");
  }
  await tx
    .insert(schema.ssoRoles)
    .values({ userId, issuer: proof.issuer, role: proof.role, confirmedAt: proof.checkedAt })
    .onConflictDoUpdate({ target: [schema.ssoRoles.userId, schema.ssoRoles.issuer], set: { role: proof.role, confirmedAt: proof.checkedAt } });
  if (proof.role !== "inhaber") await disableResponsibleTokens(tx, userId);
  if (previous && previous.role !== proof.role) await tx.delete(schema.session).where(eq(schema.session.userId, userId));

  return { oidcIssuer: proof.issuer, ssoRole: proof.role, ssoCheckedAt: proof.checkedAt, ssoExpiresAt: proof.expiresAt };
}

/**
 * Nach einer vollständig geprüften, wegen der Gruppen abgewiesenen Anmeldung einer bekannten Identität: deren
 * SSO-Sitzungen enden, die Rolle gilt als entzogen. Eigene Transaktion nach dem Rollback des Callbacks, damit der
 * Fehler-Redirect den Widerruf nicht zurücknimmt. Unbekannte Identitäten ändern nichts.
 */
export async function revokeRejectedIdentity(proof: SsoProof): Promise<void> {
  await withActor("system:oidc", async (tx) => {
    const [identity] = await tx
      .select({ userId: schema.account.userId })
      .from(schema.account)
      .where(and(eq(schema.account.providerId, "oidc"), eq(schema.account.accountId, proof.accountId)));
    if (!identity) return;
    await lockTokenResponsibility(tx, identity.userId);
    const [previous] = await tx
      .select({ confirmedAt: schema.ssoRoles.confirmedAt })
      .from(schema.ssoRoles)
      .where(and(eq(schema.ssoRoles.userId, identity.userId), eq(schema.ssoRoles.issuer, proof.issuer)))
      .for("update");
    if (previous && previous.confirmedAt > proof.checkedAt) return;
    await disableResponsibleTokens(tx, identity.userId);
    await tx.delete(schema.session).where(and(eq(schema.session.userId, identity.userId), isNotNull(schema.session.oidcIssuer)));
    await tx
      .insert(schema.ssoRoles)
      .values({ userId: identity.userId, issuer: proof.issuer, role: null, confirmedAt: proof.checkedAt })
      .onConflictDoUpdate({ target: [schema.ssoRoles.userId, schema.ssoRoles.issuer], set: { role: null, confirmedAt: sql`excluded.confirmed_at` } });
  });
}
