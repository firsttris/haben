import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { APP_RUNNING_LOCK } from "./app-lock.ts";

/*
 * Betreiberfunktion für den SSO-Modus: ordnet einem bestehenden Haben-Konto ausdrücklich eine Identität
 * (Issuer und Subject) zu. Nur auf der Kommandozeile und nur bei gestoppter Anwendung; vergibt keine Rolle, die kommt
 * bei der nächsten Anmeldung aus den Gruppen. Eigenständig (nur postgres), damit sie auch im Betriebs-Image läuft.
 *
 *   bun src/server/db/sso-uebernahme.ts --konto <Konto-ID> --subject <sub> [--issuer <url>]           # nur prüfen
 *   bun src/server/db/sso-uebernahme.ts --konto <Konto-ID> --subject <sub> [--issuer <url>] --uebernehmen
 */

export interface TakeoverRequest {
  userId: string;
  issuer: string;
  subject: string;
  /** false: nur prüfen, nichts ändern */
  apply: boolean;
}

export type TakeoverResult = { ok: true; applied: boolean; message: string } | { ok: false; message: string };

/** Derselbe Schlüssel wie im Login (oidc.ts, identityKey): Issuer und Subject gemeinsam */
const identityKey = (issuer: string, subject: string) => JSON.stringify([issuer, subject]);

class Refused extends Error {}

/**
 * Prüft und übernimmt in einer Transaktion. Abgelehnt wird: laufende Anwendung, fremder Issuer, unbekanntes Konto,
 * bereits vergebenes Subject, Konto mit anderer Identität dieses Issuers.
 */
export async function ssoTakeover(sql: postgres.Sql, request: TakeoverRequest, configuredIssuer: string | undefined): Promise<TakeoverResult> {
  const { userId, issuer, subject, apply } = request;
  if (!configuredIssuer) return { ok: false, message: "OIDC_ISSUER ist nicht gesetzt; zugeordnet wird nur zum konfigurierten Issuer." };
  if (issuer !== configuredIssuer) return { ok: false, message: `Der Issuer ${issuer} ist nicht der konfigurierte (${configuredIssuer}).` };
  if (!subject || subject.length > 255 || subject.trim() !== subject) return { ok: false, message: "Das Subject fehlt oder ist ungültig." };
  const key = identityKey(issuer, subject);
  try {
    return await sql.begin(async (tx) => {
      const [lock] = await tx`select pg_try_advisory_xact_lock(${APP_RUNNING_LOCK}) as free`;
      if (!lock?.free) throw new Refused("Haben läuft noch. Bitte die Anwendung zuerst stoppen.");
      await tx`select set_config('haben.actor', 'system:sso-uebernahme', true)`;
      const [user] = await tx`select id, name, email from "user" where id = ${userId} for update`;
      if (!user) throw new Refused(`Ein Konto ${userId} gibt es nicht.`);
      const [taken] = await tx`select user_id from account where provider_id = 'oidc' and account_id = ${key}`;
      if (taken) {
        if (taken.user_id === userId) throw new Refused("Diese Identität ist dem Konto bereits zugeordnet.");
        throw new Refused("Dieses Subject ist bereits einem anderen Konto zugeordnet.");
      }
      const existing = await tx`select account_id from account where provider_id = 'oidc' and user_id = ${userId}`;
      if (existing.some((row) => (JSON.parse(row.account_id) as unknown[])[0] === issuer))
        throw new Refused("Das Konto hat schon eine andere Identität dieses Issuers.");
      const target = `Konto ${user.name} <${user.email}> (${userId}) ← ${issuer} / ${subject}`;
      if (!apply) return { ok: true as const, applied: false, message: `Prüfung bestanden, nichts geändert: ${target}` };
      await tx`insert into account (id, account_id, provider_id, user_id, created_at, updated_at)
               values (${randomUUID()}, ${key}, 'oidc', ${userId}, now(), now())`;
      await tx`insert into sso_takeovers (user_id, issuer, subject) values (${userId}, ${issuer}, ${subject})`;
      return { ok: true as const, applied: true, message: `Übernommen: ${target}. Die Rolle kommt bei der nächsten Anmeldung aus den Gruppen.` };
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, message: error.message };
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: { konto: { type: "string" }, subject: { type: "string" }, issuer: { type: "string" }, uebernehmen: { type: "boolean", default: false } },
  });
  const url = process.env.DATABASE_URL;
  const configured = process.env.OIDC_ISSUER || undefined;
  if (!url || !values.konto || !values.subject) {
    console.error("Aufruf: sso-uebernahme.ts --konto <Konto-ID> --subject <sub> [--issuer <url>] [--uebernehmen]  (DATABASE_URL, OIDC_ISSUER gesetzt)");
    process.exit(2);
  }
  const sql = postgres(url, { max: 1 });
  try {
    const result = await ssoTakeover(
      sql,
      { userId: values.konto, subject: values.subject, issuer: values.issuer ?? configured ?? "", apply: values.uebernehmen },
      configured,
    );
    (result.ok ? console.log : console.error)(result.message);
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) await main();
