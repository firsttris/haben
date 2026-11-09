import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { db, type Tx } from "./db/index.ts";
import type { Rolle } from "../lib/rollen.ts";
import type { GroupRejection } from "./sso-groups.ts";

/** Ergebnis der vollständig geprüften Protokollantwort (ID-Token und UserInfo) eines SSO-Callbacks */
export interface SsoProof {
  issuer: string;
  subject: string;
  /** Schlüssel der Identität in account.account_id */
  accountId: string;
  checkedAt: Date;
  role?: Rolle;
  expiresAt?: Date;
  rejection?: GroupRejection | "profil";
}

/** Warum ein Callback abgewiesen wurde; bestimmt den Hinweis auf der Anmeldeseite */
export type CallbackRejection = "gruppen-doppelt" | "profil" | "gruppe" | "nicht-eingerichtet" | "konto-vorhanden" | "fehler";

interface OpenTransaction {
  tx: Tx;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
}

interface CallbackScope {
  transaction?: OpenTransaction;
  proof?: SsoProof;
  rejection?: CallbackRejection;
  /** Fehlercode aus dem Redirect von Better Auth oder vom Anbieter, etwa invalid_scope; nur fürs Log */
  failure?: string;
}

const scope = new AsyncLocalStorage<CallbackScope>();

/** Adapter und Hooks benutzen im Callback dieselbe Verbindung: Konto, Zuordnung, Rolle und Sitzung entstehen gemeinsam */
export const authTransaction = () => scope.getStore()?.transaction?.tx;
export const authDatabase = () => authTransaction() ?? db;

/** Nachweis des laufenden Callbacks; nur innerhalb von atomicAuthCallback gesetzt, nie aus Browserdaten */
export const callbackProof = () => scope.getStore()?.proof;
export function setCallbackProof(proof: SsoProof): void {
  const store = scope.getStore();
  if (!store) throw new Error("SSO-Nachweis außerhalb eines Callbacks");
  store.proof = proof;
}
export function rejectCallback(reason: CallbackRejection): void {
  const store = scope.getStore();
  if (store) store.rejection ??= reason;
}

export const authDatabaseProxy = new Proxy(db, {
  get(_target, key) {
    const current = authDatabase();
    const value = Reflect.get(current, key);
    return typeof value === "function" ? value.bind(current) : value;
  },
});

/** Hält eine Transaktion offen, bis commit oder rollback sie beendet; beides darf mehrfach laufen */
async function openTransaction(): Promise<OpenTransaction> {
  let finish!: (rollback?: Error) => void;
  const outcome = new Promise<void>((resolve, reject) => {
    finish = (rollback) => (rollback ? reject(rollback) : resolve());
  });
  let opened!: (tx: Tx) => void;
  const ready = new Promise<Tx>((resolve) => {
    opened = resolve;
  });
  const finished = db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('haben.actor', 'system:oidc', true)`);
    opened(tx);
    await outcome;
  });
  const tx = await Promise.race([ready, finished.then(() => Promise.reject(new Error("OIDC_TRANSACTION_ENDED")))]);
  return {
    tx,
    commit: () => {
      finish();
      return finished;
    },
    rollback: () => {
      finish(new Error("OIDC_CALLBACK_ROLLBACK"));
      return finished.catch(() => {});
    },
  };
}

/**
 * Öffnet die Transaktion des Callbacks, nachdem Anbieter und Gruppen geprüft sind. Better Auth liest und löscht davor nur
 * den State und schreibt erst danach Konten; alle Netzaufrufe liegen also außerhalb und belegen keine Datenbankverbindung.
 */
export async function beginCallbackWrites(): Promise<void> {
  const store = scope.getStore();
  if (!store) throw new Error("SSO-Transaktion außerhalb eines Callbacks");
  store.transaction ??= await openTransaction();
}

/** Better Auth meldet Callback-Fehler als Redirect mit „error“; der Code dort sagt, was schiefging */
function failedLocation(response: Response): string | undefined {
  const location = response.headers.get("location");
  if (response.status >= 400) return "fehler";
  if (!location) return undefined;
  return new URL(location, "http://localhost").searchParams.get("error") ?? undefined;
}

export interface AtomicCallbackOptions {
  /** Ziel bei Ablehnung, mit dem Grund als Parameter */
  errorUrl: (reason: CallbackRejection) => string;
  /** Läuft nach dem Rollback in eigener Transaktion: was eine gültige negative Entscheidung festschreiben muss */
  afterRejection?: (proof: SsoProof) => Promise<void>;
}

/**
 * Der Schreibteil des Callbacks in einer Transaktion: Einrichtung, Konto, Zuordnung, Rolle und Sitzung entstehen gemeinsam
 * oder gar nicht. Better Auth wandelt Fehler in Redirects um, deshalb rollt auch ein Fehler-Redirect zurück. Das Löschen
 * des States liegt davor und bleibt bestehen (einmalig, RFC 9700 4.7); was eine geprüfte Gruppenentscheidung verlangt
 * (Sitzungen widerrufen), läuft danach und bleibt ebenfalls bestehen.
 */
export async function atomicAuthCallback(work: () => Promise<Response>, options: AtomicCallbackOptions): Promise<Response> {
  const store: CallbackScope = {};
  try {
    const response = await scope.run(store, work);
    const failed = failedLocation(response);
    if (failed) {
      if (failed === "account_not_linked") store.rejection ??= "konto-vorhanden";
      // Kann vom Anbieter oder aus der Adresse stammen: nur unbedenkliche Zeichen ins Log
      store.failure = failed.replace(/[^\w.-]/g, "").slice(0, 60);
      throw new Error("OIDC_CALLBACK_ROLLBACK");
    }
    await store.transaction?.commit();
    return response;
  } catch {
    await store.transaction?.rollback();
    const { proof } = store;
    console.error(`SSO: Anmeldung abgewiesen: ${[store.rejection ?? "fehler", proof?.rejection, store.failure].filter(Boolean).join(", ")}`);
    if (proof?.rejection && options.afterRejection) {
      try {
        await options.afterRejection(proof);
      } catch {
        console.error("SSO: Widerruf nach abgewiesener Gruppenprüfung fehlgeschlagen");
      }
    }
    return Response.redirect(options.errorUrl(store.rejection ?? "fehler"), 303);
  }
}
