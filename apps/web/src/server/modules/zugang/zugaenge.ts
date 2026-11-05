import { asc, desc, eq, max, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { ZugangError } from "./einladungen.ts";

/*
 * Zugänge verwalten: wer Haben nutzen darf, mit welcher Rolle, wann zuletzt angemeldet. Sperren und Entfernen gibt es nur
 * für die Steuerberatung; der Inhaber bleibt immer.
 */

/** Alle Konten mit Rolle, Sperre und letzter Anmeldung; der Inhaber zuerst */
export async function listAccounts() {
  const lastLogin = db
    .select({ userId: schema.userLogins.userId, at: max(schema.userLogins.at).as("last_at") })
    .from(schema.userLogins)
    .groupBy(schema.userLogins.userId)
    .as("last_login");
  return db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.user.role,
      lockedAt: schema.user.lockedAt,
      createdAt: schema.user.createdAt,
      lastLoginAt: lastLogin.at,
    })
    .from(schema.user)
    .leftJoin(lastLogin, eq(lastLogin.userId, schema.user.id))
    .orderBy(sql`${schema.user.role} <> 'inhaber'`, asc(schema.user.createdAt));
}

/** Sperrt die Zeile eines Kontos der Steuerberatung für die Änderung; den Inhaber nie */
async function lockSteuerberatung(tx: Tx, userId: string) {
  const [row] = await tx.select({ role: schema.user.role }).from(schema.user).where(eq(schema.user.id, userId)).for("update");
  if (!row) throw new ZugangError("Diesen Zugang gibt es nicht.");
  if (row.role !== "steuerberatung") throw new ZugangError("Den Zugang des Inhabers kann man nicht sperren oder entfernen.");
}

/** Sperrt einen Zugang: keine neue Anmeldung, laufende Sitzungen enden sofort */
export async function lockAccount(actor: string, userId: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await lockSteuerberatung(tx, userId);
    await tx.update(schema.user).set({ lockedAt: new Date() }).where(eq(schema.user.id, userId));
    await tx.delete(schema.session).where(eq(schema.session.userId, userId));
  });
}

export async function unlockAccount(actor: string, userId: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await lockSteuerberatung(tx, userId);
    await tx.update(schema.user).set({ lockedAt: null }).where(eq(schema.user.id, userId));
  });
}

/**
 * Entfernt einen Zugang mit Passwort, Passkeys und Sitzungen. Name, E-Mail und Rolle bleiben im Audit-Log (Trigger auf
 * „user“), ebenso die Anmeldungen; so bleibt jeder frühere Eintrag dieses Akteurs zuzuordnen.
 */
export async function removeAccount(actor: string, userId: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await lockSteuerberatung(tx, userId);
    await tx.delete(schema.user).where(eq(schema.user.id, userId));
  });
}

/** Die letzten Anmeldungen eines Kontos, neueste zuerst */
export async function recentLogins(userId: string, limit = 2) {
  return db
    .select({ at: schema.userLogins.at, method: schema.userLogins.method })
    .from(schema.userLogins)
    .where(eq(schema.userLogins.userId, userId))
    .orderBy(desc(schema.userLogins.at), desc(schema.userLogins.id))
    .limit(limit);
}
