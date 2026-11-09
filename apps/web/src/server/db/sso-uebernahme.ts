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
 *
 * Führt der Anbieter dasselbe Konto mit neuem Subject (etwa neu angelegt), ersetzt --ersetzen die bisherige Identität
 * dieses Issuers. Sitzungen und bestätigte Rolle enden damit: Bis zur ersten Anmeldung mit dem neuen Subject gilt nichts.
 */

export interface TakeoverRequest {
  userId: string;
  issuer: string;
  subject: string;
  /** false: nur prüfen, nichts ändern */
  apply: boolean;
  /** Die bisherige Identität dieses Issuers ersetzen, statt abzulehnen */
  replace?: boolean;
}

export type TakeoverResult = { ok: true; applied: boolean; message: string } | { ok: false; message: string };

/** Derselbe Schlüssel wie im Login (oidc.ts, identityKey): Issuer und Subject gemeinsam */
const identityKey = (issuer: string, subject: string) => JSON.stringify([issuer, subject]);

const refused = (message: string) => ({ refused: true, message });

/**
 * Prüft und übernimmt in einer Transaktion. Abgelehnt wird: laufende Anwendung, fremder Issuer, unbekanntes Konto,
 * bereits vergebenes Subject, Konto mit anderer Identität dieses Issuers (außer mit `replace`), `replace` ohne Identität.
 */
export async function ssoTakeover(sql: postgres.Sql, request: TakeoverRequest, configuredIssuer: string | undefined): Promise<TakeoverResult> {
  const { userId, issuer, subject, apply, replace = false } = request;
  if (!configuredIssuer) return { ok: false, message: "OIDC_ISSUER ist nicht gesetzt; zugeordnet wird nur zum konfigurierten Issuer." };
  if (issuer !== configuredIssuer) return { ok: false, message: `Der Issuer ${issuer} ist nicht der konfigurierte (${configuredIssuer}).` };
  if (!subject || subject.length > 255 || subject.trim() !== subject) return { ok: false, message: "Das Subject fehlt oder ist ungültig." };
  const key = identityKey(issuer, subject);
  try {
    return await sql.begin(async (tx) => {
      const [lock] = await tx`select pg_try_advisory_xact_lock(${APP_RUNNING_LOCK}) as free`;
      if (!lock?.free) throw refused("Haben läuft noch. Bitte die Anwendung zuerst stoppen.");
      await tx`select set_config('haben.actor', 'system:sso-uebernahme', true)`;
      const [user] = await tx`select id, name, email from "user" where id = ${userId} for update`;
      if (!user) throw refused(`Ein Konto ${userId} gibt es nicht.`);
      const [taken] = await tx`select user_id from account where provider_id = 'oidc' and account_id = ${key}`;
      if (taken) {
        if (taken.user_id === userId) throw refused("Diese Identität ist dem Konto bereits zugeordnet.");
        throw refused("Dieses Subject ist bereits einem anderen Konto zugeordnet.");
      }
      const accounts = await tx`select id, account_id from account where provider_id = 'oidc' and user_id = ${userId}`;
      const previous = accounts
        .map((row) => ({ id: row.id as string, identity: JSON.parse(row.account_id) as string[] }))
        .find((row) => row.identity[0] === issuer);
      if (previous && !replace) throw refused("Das Konto hat schon eine andere Identität dieses Issuers. Ersetzen nur ausdrücklich mit --ersetzen.");
      if (!previous && replace) throw refused("Das Konto hat keine Identität dieses Issuers, die sich ersetzen ließe.");
      const replacedSubject = previous?.identity[1] ?? null;
      const target = `Konto ${user.name} <${user.email}> (${userId}) ← ${issuer} / ${subject}${replacedSubject ? ` (ersetzt ${replacedSubject})` : ""}`;
      if (!apply) return { ok: true as const, applied: false, message: `Prüfung bestanden, nichts geändert: ${target}` };
      if (previous) {
        await tx`delete from account where id = ${previous.id}`;
        await tx`delete from session where user_id = ${userId}`;
        await tx`delete from sso_roles where user_id = ${userId} and issuer = ${issuer}`;
      }
      await tx`insert into account (id, account_id, provider_id, user_id, created_at, updated_at)
               values (${randomUUID()}, ${key}, 'oidc', ${userId}, now(), now())`;
      await tx`insert into sso_takeovers (user_id, issuer, subject, replaced_subject) values (${userId}, ${issuer}, ${subject}, ${replacedSubject})`;
      return { ok: true as const, applied: true, message: `Übernommen: ${target}. Die Rolle kommt bei der nächsten Anmeldung aus den Gruppen.` };
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "refused" in error && "message" in error) return { ok: false, message: String(error.message) };
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      konto: { type: "string" },
      subject: { type: "string" },
      issuer: { type: "string" },
      uebernehmen: { type: "boolean", default: false },
      ersetzen: { type: "boolean", default: false },
    },
  });
  const url = process.env.DATABASE_URL;
  const configured = process.env.OIDC_ISSUER || undefined;
  if (!url || !values.konto || !values.subject) {
    console.error(
      "Aufruf: sso-uebernahme.ts --konto <Konto-ID> --subject <sub> [--issuer <url>] [--uebernehmen] [--ersetzen]  (DATABASE_URL, OIDC_ISSUER gesetzt)",
    );
    process.exit(2);
  }
  const sql = postgres(url, { max: 1 });
  try {
    const result = await ssoTakeover(
      sql,
      { userId: values.konto, subject: values.subject, issuer: values.issuer ?? configured ?? "", apply: values.uebernehmen, replace: values.ersetzen },
      configured,
    );
    (result.ok ? console.log : console.error)(result.message);
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) await main();
