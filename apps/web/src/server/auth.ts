import { passkey } from "@better-auth/passkey";
import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { count } from "drizzle-orm";
import { INVITATION_HEADER, accountState, claimInvitation, linkInvitation, loginMethod, openInvitation, recordLogin } from "./anmeldung.ts";
import { atomicAuthCallback, authDatabase, authDatabaseProxy, authTransaction } from "./auth-transaction.ts";
import { schema } from "./db/index.ts";
import { env } from "./env.ts";
import { oidcBefore, oidcProvider, withoutProviderTokens } from "./oidc.ts";
import { checkSetupCode } from "./setup-code.ts";
import { confirmSsoSession, requireGrantedProof, revokeRejectedIdentity } from "./sso-callback.ts";
import { modeStartupProblem } from "./sso-mode.ts";
import { enforceMode, LOCAL_AUTH_PATHS, ssoOnly } from "./sso-policy.ts";

const forbidden = (message: string) => new APIError("FORBIDDEN", { message });

/** Standardmodus: das erste Konto ist der Inhaber, jedes weitere kommt nur mit einer Einladung und mit deren Rolle */
async function localUserRole(user: { email: string }, invitation: string | null | undefined) {
  if (invitation) {
    const claimed = await claimInvitation(invitation, user.email);
    if (!claimed) throw forbidden("Die Einladung ist ungültig, abgelaufen oder schon eingelöst.");
    return claimed.role;
  }
  const [row] = await authDatabase().select({ n: count() }).from(schema.user);
  if ((row?.n ?? 0) > 0) throw forbidden("Haben ist bereits eingerichtet. Weitere Zugänge gibt es nur per Einladung.");
  return "inhaber" as const;
}

function createAuth() {
  const baseUrl = new URL(env().BETTER_AUTH_URL);
  const sso = ssoOnly();
  return betterAuth({
    baseURL: baseUrl.origin,
    secret: env().BETTER_AUTH_SECRET,
    database: drizzleAdapter(authDatabaseProxy, { provider: "pg", schema }),
    // Standardmodus: Passwort für die Ersteinrichtung und als Rückfallebene, Anmeldung per Passkey. SSO-Modus: nichts Lokales.
    emailAndPassword: { enabled: !sso, minPasswordLength: 12 },
    disabledPaths: sso ? LOCAL_AUTH_PATHS : [],
    rateLimit: { enabled: true, window: 60, max: 20 },
    // Haben läuft hinter Caddy; die Client-Adresse kommt aus X-Forwarded-For.
    advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
    account: {
      // Keine Verknüpfung und keine Zusammenführung anhand gleicher E-Mail; bestehende Konten übernimmt nur der Betreiber
      accountLinking: { enabled: false, disableImplicitLinking: true },
      storeAccountCookie: false,
      storeStateStrategy: "database",
    },
    session: {
      additionalFields: {
        oidcIssuer: { type: "string", input: false, required: false },
        ssoRole: { type: "string", input: false, required: false },
        ssoCheckedAt: { type: "date", input: false, required: false },
        ssoExpiresAt: { type: "date", input: false, required: false },
      },
    },
    logger: { disabled: true },
    plugins: [...oidcProvider(), ...(sso ? [] : [passkey({ rpID: baseUrl.hostname, rpName: "Haben", origin: baseUrl.origin })]), tanstackStartCookies()],
    user: {
      // Rolle und Sperre setzt nur der Server (Hooks unten, Modul zugang), nie die Anfrage
      additionalFields: {
        role: { type: "string", input: false, required: false },
        lockedAt: { type: "date", input: false, required: false },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await enforceMode(ctx);
        await oidcBefore(ctx);
        // Name und Bild ändert Haben nicht über Better Auth: das schriebe ohne Audit-Akteur und an der Rollenprüfung
        // vorbei, auch für die Steuerberatung, die nur lesen darf
        if (ctx.path === "/update-user") throw forbidden("Das Konto lässt sich hier nicht ändern.");
        // Ein Konto legt nur an, wer den Einrichtungscode aus dem Server-Log (erstes Konto) oder eine gültige Einladung hat
        if (ctx.path !== "/sign-up/email") return;
        const invitation = ctx.headers?.get(INVITATION_HEADER);
        if (invitation) {
          if (!(await openInvitation(invitation))) throw forbidden("Die Einladung ist ungültig, abgelaufen oder schon eingelöst.");
        } else if (!checkSetupCode(ctx.headers?.get("x-haben-setup-code"))) {
          throw forbidden("Der Einrichtungscode stimmt nicht.");
        }
      }),
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => {
            if (sso !== (account.providerId === "oidc")) throw forbidden("Diese Zuordnung passt nicht zur Betriebsart.");
            return { data: withoutProviderTokens(account) };
          },
        },
        update: { before: async (account) => ({ data: withoutProviderTokens(account) }) },
      },
      user: {
        create: {
          // SSO: nur mit geprüfter Gruppenzuordnung im Callback, ohne lokale Rolle. Standard: Einrichtung oder Einladung.
          before: async (user, ctx) => {
            if (sso) {
              requireGrantedProof();
              return { data: { ...user, role: null } };
            }
            if (ctx?.path !== "/sign-up/email") throw forbidden("Konten entstehen hier nur über Einrichtung oder Einladung.");
            return { data: { ...user, role: await localUserRole(user, ctx.headers?.get(INVITATION_HEADER)) } };
          },
          after: async (user, ctx) => {
            const invitation = !sso && ctx?.headers?.get(INVITATION_HEADER);
            if (invitation) await linkInvitation(invitation, user.id);
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            if (sso) {
              if (!ctx?.path?.startsWith("/callback/")) throw forbidden("Eine Anmeldung ist nur über SSO möglich.");
              return { data: { ...session, ...(await confirmSsoSession(session.userId)) } };
            }
            // Ein gesperrter Zugang bekommt keine Sitzung, auch nicht mit Passkey
            const state = await accountState(session.userId, authDatabase());
            if (!state?.role || state.locked) throw forbidden("Dieser Zugang ist gesperrt.");
            return { data: { ...session, oidcIssuer: null, ssoRole: null, ssoCheckedAt: null, ssoExpiresAt: null } };
          },
          // Jede Anmeldung steht im Audit-Log, mit der wirksamen Rolle und Art
          after: async (session, ctx) => {
            const role = sso ? (session as { ssoRole?: string }).ssoRole : (await accountState(session.userId, authDatabase()))?.role;
            if (role === "inhaber" || role === "steuerberatung") await recordLogin(session.userId, role, loginMethod(ctx?.path), authTransaction());
          },
        },
      },
    },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

export function auth() {
  instance ??= createAuth();
  return instance;
}

const loginUrl = (reason: string) => `${env().BETTER_AUTH_URL.replace(/\/$/, "")}/login?sso=${reason}`;

/** Einstieg für /api/auth/*: Startprüfung der Betriebsart, Callback atomar, Anbieterstörungen ohne Datenbankverbindung */
export async function handleAuth(request: Request): Promise<Response> {
  const problem = await modeStartupProblem();
  if (problem) return new Response(problem, { status: 503 });
  const current = auth();
  const path = new URL(request.url).pathname;
  if (ssoOnly() && (path === "/api/auth/sign-in/social" || path === "/api/auth/callback/oidc")) {
    // Discovery beim Start des Anbieters darf keine der begrenzten Datenbankverbindungen belegen
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        current.$context,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("OIDC_TIMEOUT")), 10_000);
        }),
      ]);
    } catch {
      return new Response("Die SSO-Anmeldung ist vorübergehend nicht verfügbar.", { status: 503 });
    } finally {
      clearTimeout(timer);
    }
  }
  if (ssoOnly() && path === "/api/auth/callback/oidc") {
    const state = new URL(request.url).searchParams.get("state");
    return atomicAuthCallback(() => current.handler(request), {
      errorUrl: loginUrl,
      afterRejection: revokeRejectedIdentity,
      stateIdentifier: state ? `auth-state:${state}` : undefined,
    });
  }
  return current.handler(request);
}
