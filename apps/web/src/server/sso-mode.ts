import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import postgres from "postgres";
import { APP_RUNNING_LOCK } from "./db/app-lock.ts";
import { db, schema, type Db } from "./db/index.ts";
import { env } from "./env.ts";
import { ssoOnly } from "./sso-policy.ts";

/*
 * Moduswechsel beim Start: Sitzungen der anderen Betriebsart entwerten und für den Standardmodus einen verwendbaren
 * lokalen Inhaber verlangen. Gespeicherte lokale Zugangsdaten bleiben in beiden Richtungen unangetastet.
 */

export const LOCAL_OWNER_MISSING =
  "Standardmodus (OIDC_ONLY=false) ohne verwendbaren lokalen Inhaber: Es gibt Konten, aber keinen ungesperrten Inhaber mit Passwort oder Passkey. " +
  "Bitte OIDC_ONLY=true lassen oder den lokalen Inhaber wiederherstellen; Haben erzeugt keine Zugangsdaten.";

/** Ob es im Standardmodus jemanden gibt, der sich lokal als Inhaber anmelden kann; eine leere Instanz braucht niemanden */
export async function localOwnerUsable(q: Db = db): Promise<boolean> {
  const [anyUser] = await q.select({ id: schema.user.id }).from(schema.user).limit(1);
  if (!anyUser) return true;
  const [owner] = await q
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(
      and(
        eq(schema.user.role, "inhaber"),
        isNull(schema.user.lockedAt),
        or(
          sql`exists (select 1 from ${schema.account} where ${schema.account.userId} = ${schema.user.id} and ${schema.account.providerId} = 'credential' and ${schema.account.password} is not null)`,
          sql`exists (select 1 from ${schema.passkey} where ${schema.passkey.userId} = ${schema.user.id})`,
        ),
      ),
    )
    .limit(1);
  return !!owner;
}

/** Löscht alle Sitzungen, die in der laufenden Betriebsart nicht gelten; sie würden ohnehin abgewiesen */
export async function discardForeignSessions(q: Db = db): Promise<void> {
  const foreign = ssoOnly()
    ? or(isNull(schema.session.oidcIssuer), sql`${schema.session.oidcIssuer} <> ${env().OIDC_ISSUER!}`, isNull(schema.session.ssoRole))
    : isNotNull(schema.session.oidcIssuer);
  await q.delete(schema.session).where(foreign);
}

/** Problem, das den Start verhindert, oder null. Einmal je Prozess geprüft. */
export async function checkModeOnStartup(q: Db = db): Promise<string | null> {
  if (!ssoOnly() && !(await localOwnerUsable(q))) return LOCAL_OWNER_MISSING;
  await discardForeignSessions(q);
  return null;
}

let startupCheck: Promise<string | null> | undefined;

/** Für jede Auth-Anfrage: das Ergebnis der Startprüfung, ohne sie zu wiederholen (je Bundle einmal) */
export function modeStartupProblem(): Promise<string | null> {
  startupCheck ??= checkModeOnStartup().catch((error: unknown) => {
    startupCheck = undefined;
    throw error;
  });
  return startupCheck;
}

/** Hält den geteilten Lock bis zum Prozessende auf einer eigenen Verbindung */
export async function holdAppRunningLock(): Promise<() => Promise<void>> {
  const client = postgres(env().DATABASE_URL, { max: 1, idle_timeout: 0 });
  const reserved = await client.reserve();
  await reserved`select pg_advisory_lock_shared(${APP_RUNNING_LOCK})`;
  return async () => {
    reserved.release();
    await client.end({ timeout: 5 });
  };
}
