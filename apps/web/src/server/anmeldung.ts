import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { withActor } from "./db/actor.ts";
import { db, schema, type Db, type Tx } from "./db/index.ts";
import type { Rolle } from "../lib/rollen.ts";

/*
 * Was Better Auth (auth.ts) für weitere Zugänge braucht: Einladungen prüfen und einlösen, gesperrte Konten erkennen und
 * Anmeldungen protokollieren. Anlegen, Auflisten und Sperren macht das Modul `zugang` für die Einstellungen.
 */

/** Kopfzeile, mit der die Seite /einladung/<token> das Token an /sign-up/email mitschickt */
export const INVITATION_HEADER = "x-haben-einladung";

/** Gespeichert wird nur der SHA-256 des Tokens; wer die Datenbank liest, kann keine Einladung einlösen */
export const invitationHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Bedingung für eine noch einlösbare Einladung: nicht eingelöst, nicht zurückgezogen, nicht abgelaufen */
const usable = (token: string) =>
  and(
    eq(schema.invitations.tokenHash, invitationHash(token)),
    isNull(schema.invitations.acceptedAt),
    isNull(schema.invitations.revokedAt),
    gt(schema.invitations.expiresAt, sql`now()`),
  );

/** Die Einladung zu `token`, solange sie einlösbar ist; sonst null */
export async function openInvitation(token: string, q: Db | Tx = db) {
  if (!token) return null;
  const [row] = await q
    .select({ id: schema.invitations.id, role: schema.invitations.role, label: schema.invitations.label, expiresAt: schema.invitations.expiresAt })
    .from(schema.invitations)
    .where(usable(token));
  return row ?? null;
}

/**
 * Löst die Einladung atomar ein und gibt ihre Rolle zurück, oder null, wenn sie nicht (mehr) gilt. Zwei gleichzeitige
 * Anmeldungen mit demselben Link: nur eine bekommt die Zeile.
 */
export async function claimInvitation(token: string, email: string): Promise<{ id: string; role: Rolle } | null> {
  const [row] = await withActor("system:einladung", (tx) =>
    tx
      .update(schema.invitations)
      .set({ acceptedAt: sql`now()`, acceptedEmail: email })
      .where(usable(token))
      .returning({ id: schema.invitations.id, role: schema.invitations.role }),
  );
  return row ?? null;
}

/** Vermerkt an der eingelösten Einladung das Konto, das mit ihr entstanden ist */
export async function linkInvitation(token: string, userId: string): Promise<void> {
  await withActor("system:einladung", (tx) =>
    tx
      .update(schema.invitations)
      .set({ userId })
      .where(and(eq(schema.invitations.tokenHash, invitationHash(token)), isNull(schema.invitations.userId))),
  );
}

/** Lokale Rolle und Sperre eines Kontos; null, wenn es das Konto nicht gibt. Nur per SSO entstandene Konten haben keine Rolle. */
export async function accountState(userId: string, q: Db | Tx = db): Promise<{ role: Rolle | null; locked: boolean } | null> {
  const [row] = await q.select({ role: schema.user.role, lockedAt: schema.user.lockedAt }).from(schema.user).where(eq(schema.user.id, userId));
  return row ? { role: row.role, locked: row.lockedAt !== null } : null;
}

/** Art der Anmeldung aus dem Pfad von Better Auth */
export function loginMethod(path: string | undefined): string {
  if (path?.startsWith("/sign-in/passkey") || path?.startsWith("/passkey/")) return "passkey";
  if (path === "/sign-in/email") return "passwort";
  if (path?.startsWith("/callback/")) return "sso";
  if (path === "/sign-up/email") return "einrichtung";
  return path ?? "unbekannt";
}

/** Protokolliert eine Anmeldung, Akteur ist das Konto selbst; im SSO-Callback in dessen Transaktion */
export async function recordLogin(userId: string, role: Rolle, method: string, transaction?: Tx): Promise<void> {
  const write = (tx: Tx) => tx.insert(schema.userLogins).values({ userId, role, method });
  if (!transaction) return void (await withActor(userId, write));
  await transaction.execute(sql`select set_config('haben.actor', ${userId}, true)`);
  await write(transaction);
}
