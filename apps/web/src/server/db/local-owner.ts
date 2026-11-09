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

/** Offline-Betreiberfunktion: erhält die Konto-ID, SSO-Zuordnungen und sämtliche Buchhaltungsdaten. */
export async function prepareLocalOwner(client: postgres.Sql, request: LocalOwnerRequest) {
  const passwordHash = request.password === undefined ? null : await hashPassword(request.password);
  if (request.password !== undefined && request.password.length < 12) throw new Error("Das Passwort muss mindestens 12 Zeichen haben.");
  return client.begin(async (tx) => {
    const [lock] = await tx`select pg_try_advisory_xact_lock(${APP_RUNNING_LOCK}) as free`;
    if (!lock?.free) throw new Error("Haben läuft noch. Zuerst alle Instanzen stoppen.");
    const [user] = await tx`select id from "user" where id=${request.userId} for update`;
    if (!user) throw new Error("Das ausgewählte Konto gibt es nicht.");
    const [other] = await tx`select id from "user" where role='inhaber' and id<>${request.userId}`;
    if (other) throw new Error("Es gibt bereits einen anderen lokalen Inhaber. Diesen verwenden oder ausdrücklich wiederherstellen.");
    const [credential] = await tx`select id from account where user_id=${request.userId} and provider_id='credential' and password is not null`;
    const [passkey] = await tx`select id from passkey where user_id=${request.userId} limit 1`;
    if (!request.apply) return { applied: false, passwordRequired: !credential && !passkey };
    if (!credential && !passkey && !passwordHash)
      throw new Error("Für dieses Konto fehlt ein lokaler Zugang. Passwort über die geschützte Standardeingabe setzen.");
    await tx`select set_config('haben.actor', 'system:local-owner-recovery', true)`;
    await tx`select haben_prepare_local_owner(${request.userId})`;
    if (!credential && !passkey)
      await tx`insert into account(id,account_id,provider_id,user_id,password) values(${randomUUID()},${request.userId},'credential',${request.userId},${passwordHash})`;
    await tx`delete from session`;
    return { applied: true, passwordRequired: false };
  });
}

async function main() {
  const { values } = parseArgs({
    options: { konto: { type: "string" }, uebernehmen: { type: "boolean", default: false }, "passwort-stdin": { type: "boolean", default: false } },
  });
  if (!process.env.DATABASE_URL || !values.konto)
    throw new Error("Aufruf: local-owner.ts --konto <ID> [--uebernehmen] [--passwort-stdin]; DATABASE_URL muss gesetzt sein.");
  // Nur Pipe/Dateideskriptor; kein Passwort als Argument, keine Ausgabe und kein Echo im Terminal.
  if (values["passwort-stdin"] && process.stdin.isTTY)
    throw new Error("Passwort aus einem geschützten Eingabekanal übergeben, nicht im sichtbaren Terminal eingeben.");
  const password = values["passwort-stdin"] ? readFileSync(0, "utf8").replace(/\r?\n$/, "") : undefined;
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const result = await prepareLocalOwner(client, { userId: values.konto, apply: values.uebernehmen, password });
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
    console.error("Vorbereitung fehlgeschlagen. Konto-ID, exklusiven Stillstand, vorhandenen lokalen Inhaber und geschützte Passworteingabe prüfen.");
    process.exitCode = 1;
  });
