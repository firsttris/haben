import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { hashPassword } from "better-auth/crypto";
import postgres from "postgres";
import { APP_RUNNING_LOCK } from "./app-lock.ts";

export interface LocalOwnerRequest {
  userId: string;
  apply: boolean;
  password?: string;
}

async function offlineOwnerTransaction<T>(client: postgres.Sql, work: (tx: postgres.TransactionSql) => Promise<T>) {
  return client.begin(async (tx) => {
    const [lock] = await tx`select pg_try_advisory_xact_lock(${APP_RUNNING_LOCK}) as free`;
    if (!lock?.free) throw new Error("Haben läuft noch. Zuerst alle Instanzen stoppen.");
    return work(tx);
  });
}

async function passwordHash(password: string) {
  if (password.length < 12) throw new Error("Das Passwort muss mindestens 12 Zeichen haben.");
  if (password.length > 128) throw new Error("Das Passwort darf höchstens 128 Zeichen haben.");
  return hashPassword(password);
}

async function writePassword(tx: postgres.TransactionSql, userId: string, hash: string) {
  const updated = await tx`update account set password=${hash}, updated_at=now() where user_id=${userId} and provider_id='credential'`;
  if (!updated.count)
    await tx`insert into account(id,account_id,provider_id,user_id,password) values(${randomUUID()},${userId},'credential',${userId},${hash})`;
}

/** Setzt nur das Passwort des vorhandenen lokalen Inhabers bei gestoppter Anwendung zurück. */
export async function resetLocalOwnerPassword(client: postgres.Sql, password: string, oidcOnly: boolean) {
  if (oidcOnly) throw new Error("Das Passwort wird im SSO-Modus beim Anmeldeanbieter zurückgesetzt.");
  const hash = await passwordHash(password);
  await offlineOwnerTransaction(client, async (tx) => {
    const [owner] = await tx`select id, locked_at from "user" where role='inhaber' for update`;
    if (!owner || owner.locked_at !== null) throw new Error("Es gibt keinen aktiven lokalen Inhaber.");
    await tx`select set_config('haben.actor', 'system:local-owner-recovery', true)`;
    await writePassword(tx, owner.id, hash);
    // Nach der Wiederherstellung muss sich der Inhaber neu anmelden (OWASP Forgot Password Cheat Sheet).
    // https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html#user-resets-password
    await tx`delete from session where user_id=${owner.id}`;
    await tx`insert into audit_log (actor, table_name, row_id, action, new_value)
      values (current_setting('haben.actor'), 'user', ${owner.id}, 'UPDATE', jsonb_build_object('ereignis', 'passwort_zurueckgesetzt'))`;
  });
}

/** Offline-Betreiberfunktion: erhält die Konto-ID, SSO-Zuordnungen und sämtliche Buchhaltungsdaten. */
export async function prepareLocalOwner(client: postgres.Sql, request: LocalOwnerRequest) {
  const hash = request.password === undefined ? null : await passwordHash(request.password);
  return offlineOwnerTransaction(client, async (tx) => {
    const [user] = await tx`select id, role from "user" where id=${request.userId} for update`;
    if (!user) throw new Error("Das ausgewählte Konto gibt es nicht.");
    if (user.role === "steuerberatung") throw new Error("Aus einem Konto der Steuerberatung wird kein Inhaber.");
    const [other] = await tx`select id from "user" where role='inhaber' and id<>${request.userId}`;
    if (other) throw new Error("Es gibt bereits einen anderen lokalen Inhaber. Diesen verwenden oder ausdrücklich wiederherstellen.");
    const [credential] = await tx`select id from account where user_id=${request.userId} and provider_id='credential' and password is not null`;
    const [passkey] = await tx`select id from passkey where user_id=${request.userId} limit 1`;
    if (!request.apply) return { applied: false, passwordRequired: !credential && !passkey };
    if (!credential && !passkey && !hash) throw new Error("Für dieses Konto fehlt ein lokaler Zugang. Passwort über die geschützte Standardeingabe setzen.");
    await tx`select set_config('haben.actor', 'system:local-owner-recovery', true)`;
    await tx`select haben_prepare_local_owner(${request.userId})`;
    if (hash) await writePassword(tx, request.userId, hash);
    await tx`delete from session`;
    return { applied: true, passwordRequired: false };
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      konto: { type: "string" },
      uebernehmen: { type: "boolean", default: false },
      "passwort-zuruecksetzen": { type: "boolean", default: false },
      "passwort-stdin": { type: "boolean", default: false },
    },
  });
  const reset = values["passwort-zuruecksetzen"];
  if (!process.env.DATABASE_URL || (reset ? values.konto !== undefined || values.uebernehmen || !values["passwort-stdin"] : !values.konto)) {
    console.error("Aufruf: local-owner.ts --passwort-zuruecksetzen --passwort-stdin oder --konto <ID> [--uebernehmen] [--passwort-stdin].");
    throw new Error("Aufruf oder DATABASE_URL ungültig.");
  }
  // Nur Pipe/Dateideskriptor; kein Passwort als Argument, keine Ausgabe und kein Echo im Terminal.
  if (values["passwort-stdin"] && process.stdin.isTTY)
    throw new Error("Passwort aus einem geschützten Eingabekanal übergeben, nicht im sichtbaren Terminal eingeben.");
  const password = values["passwort-stdin"] ? readFileSync(0, "utf8").replace(/\r?\n$/, "") : undefined;
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    if (reset) {
      await resetLocalOwnerPassword(client, password!, process.env.OIDC_ONLY === "true");
      console.log("Inhaberpasswort zurückgesetzt. Haben neu starten und mit dem neuen Passwort anmelden.");
      return;
    }
    const result = await prepareLocalOwner(client, { userId: values.konto!, apply: values.uebernehmen, password });
    console.log(
      result.applied
        ? "Lokaler Inhaber vorbereitet. OIDC_ONLY=false setzen und Haben neu starten."
        : `Prüfung bestanden, nichts geändert.${result.passwordRequired ? " Ein lokales Passwort ist erforderlich." : " Lokale Zugangsdaten sind vorhanden."}`,
    );
  } finally {
    await client.end();
  }
}

if (import.meta.main)
  await main().catch(() => {
    console.error("Vorgang fehlgeschlagen. Anmeldungstyp, vorhandenes Konto, Stillstand und geschützte Passworteingabe mit 12 bis 128 Zeichen prüfen.");
    process.exitCode = 1;
  });
