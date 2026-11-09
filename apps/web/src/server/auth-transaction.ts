import { AsyncLocalStorage } from "node:async_hooks";
import { eq, sql } from "drizzle-orm";
import { db, schema, type Tx } from "./db/index.ts";
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
  rejection?: GroupRejection;
}

/** Warum ein Callback abgewiesen wurde; bestimmt den Hinweis auf der Anmeldeseite */
export type CallbackRejection = "gruppe" | "nicht-eingerichtet" | "konto-vorhanden" | "fehler";

interface CallbackScope {
  tx: Tx;
  proof?: SsoProof;
  rejection?: CallbackRejection;
  stateConsumed?: boolean;
}

const scope = new AsyncLocalStorage<CallbackScope>();
const LIMIT = Symbol.for("haben.oidcCallbacks");
const shared = globalThis as { [LIMIT]?: { active: number } };
shared[LIMIT] ??= { active: 0 };
const callbacks = shared[LIMIT];

/** Adapter und Hooks benutzen im Callback dieselbe Verbindung: Konto, Zuordnung, Rolle und Sitzung entstehen gemeinsam */
export const authDatabase = () => scope.getStore()?.tx ?? db;
export const authTransaction = () => scope.getStore()?.tx;

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
  /** verification.identifier des OAuth-States dieses Callbacks (Better Auth: `auth-state:<state>`) */
  stateIdentifier?: string;
}

/** Ob Better Auth den State in der Callback-Transaktion schon verbraucht (gelöscht) hat */
async function stateConsumed(tx: Tx, identifier: string | undefined): Promise<boolean> {
  if (!identifier) return false;
  const rows = await tx.select({ id: schema.verification.id }).from(schema.verification).where(eq(schema.verification.identifier, identifier));
  return rows.length === 0;
}

/**
 * Der ganze Callback in einer Transaktion: Einrichtung, Konto, Zuordnung, Rolle und Sitzung entstehen gemeinsam oder
 * gar nicht. Better Auth wandelt Fehler in Redirects um, deshalb rollt auch ein Fehler-Redirect zurück. Was eine
 * geprüfte Gruppenentscheidung verlangt (Sitzungen widerrufen), läuft danach und bleibt bestehen.
 */
export async function atomicAuthCallback(work: () => Promise<Response>, options: AtomicCallbackOptions): Promise<Response> {
  // Netzwerk während des Codeaustauschs darf den Pool nicht erschöpfen. Lokale Anmeldung behält Verbindungen.
  if (callbacks.active >= 2) return new Response("Bitte die SSO-Anmeldung erneut versuchen.", { status: 429, headers: { "Retry-After": "1" } });
  callbacks.active++;
  const state: Partial<CallbackScope> = {};
  try {
    return await db.transaction(async (tx) => {
      const store: CallbackScope = { tx };
      return scope.run(store, async () => {
        try {
          await tx.execute(sql`select set_config('haben.actor', 'system:oidc', true)`);
          const response = await work();
          const failed = failedLocation(response);
          if (failed) {
            if (failed === "account_not_linked") store.rejection ??= "konto-vorhanden";
            store.stateConsumed = await stateConsumed(tx, options.stateIdentifier);
            throw new Error("OIDC_CALLBACK_ROLLBACK");
          }
          return response;
        } finally {
          state.proof = store.proof;
          state.rejection = store.rejection;
          state.stateConsumed = store.stateConsumed;
        }
      });
    });
  } catch {
    // Das Rollback nähme auch das Löschen des States zurück; State, Nonce und PKCE-Verifier gelten aber nur einmal
    // (OAuth 2.0 Security BCP, RFC 9700 4.7). Nur löschen, was Better Auth selbst schon verbraucht hatte.
    if (state.stateConsumed && options.stateIdentifier) {
      await db
        .delete(schema.verification)
        .where(eq(schema.verification.identifier, options.stateIdentifier))
        .catch((error: unknown) => console.error("SSO: State nach abgewiesenem Callback nicht entwertet", error));
    }
    const proof = state.proof;
    if (proof?.rejection && options.afterRejection) {
      try {
        await options.afterRejection(proof);
      } catch (error) {
        console.error("SSO: Widerruf nach abgewiesener Gruppenprüfung fehlgeschlagen", error);
      }
    }
    return Response.redirect(options.errorUrl(state.rejection ?? "fehler"), 303);
  } finally {
    callbacks.active--;
  }
}
