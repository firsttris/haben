import { passkey } from "@better-auth/passkey";
import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { count } from "drizzle-orm";
import { db, schema } from "./db/index.ts";
import { env } from "./env.ts";
import { INVITATION_HEADER, accountState, claimInvitation, linkInvitation, loginMethod, openInvitation, recordLogin } from "./anmeldung.ts";
import { checkSetupCode } from "./setup-code.ts";

function createAuth() {
  const baseUrl = new URL(env().BETTER_AUTH_URL);
  return betterAuth({
    baseURL: baseUrl.origin,
    secret: env().BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    // Passwort nur für die Ersteinrichtung und als Rückfallebene; Anmeldung per Passkey.
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    rateLimit: { enabled: true, window: 60, max: 20 },
    // Haben läuft hinter Caddy; die Client-Adresse kommt aus X-Forwarded-For.
    advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
    plugins: [passkey({ rpID: baseUrl.hostname, rpName: "Haben", origin: baseUrl.origin }), tanstackStartCookies()],
    user: {
      // Rolle und Sperre setzt nur der Server (Hooks unten, Modul zugang), nie die Anfrage
      additionalFields: {
        role: { type: "string", input: false, required: false },
        lockedAt: { type: "date", input: false, required: false },
      },
    },
    hooks: {
      // Ein Konto legt nur an, wer den Einrichtungscode aus dem Server-Log (erstes Konto) oder eine gültige Einladung hat
      before: createAuthMiddleware(async (ctx) => {
        // Name und Bild ändert Haben nicht über Better Auth: das schriebe ohne Audit-Akteur und an der Rollenprüfung
        // vorbei, auch für die Steuerberatung, die nur lesen darf
        if (ctx.path === "/update-user") throw new APIError("FORBIDDEN", { message: "Das Konto lässt sich hier nicht ändern." });
        if (ctx.path !== "/sign-up/email") return;
        const invitation = ctx.headers?.get(INVITATION_HEADER);
        if (invitation) {
          if (!(await openInvitation(invitation))) throw new APIError("FORBIDDEN", { message: "Die Einladung ist ungültig, abgelaufen oder schon eingelöst." });
        } else if (!checkSetupCode(ctx.headers?.get("x-haben-setup-code"))) {
          throw new APIError("FORBIDDEN", { message: "Der Einrichtungscode stimmt nicht." });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Das erste Konto ist der Inhaber; jedes weitere nur mit einer Einladung und mit deren Rolle. Kein Selbst-Registrieren.
          before: async (user, ctx) => {
            const invitation = ctx?.headers?.get(INVITATION_HEADER);
            if (invitation) {
              const claimed = await claimInvitation(invitation, user.email);
              if (!claimed) throw new APIError("FORBIDDEN", { message: "Die Einladung ist ungültig, abgelaufen oder schon eingelöst." });
              return { data: { ...user, role: claimed.role } };
            }
            const [row] = await db.select({ n: count() }).from(schema.user);
            if ((row?.n ?? 0) > 0) {
              throw new APIError("FORBIDDEN", { message: "Haben ist bereits eingerichtet. Weitere Zugänge gibt es nur per Einladung." });
            }
            return { data: { ...user, role: "inhaber" } };
          },
          after: async (user, ctx) => {
            const invitation = ctx?.headers?.get(INVITATION_HEADER);
            if (invitation) await linkInvitation(invitation, user.id);
          },
        },
      },
      session: {
        create: {
          // Ein gesperrter Zugang bekommt keine Sitzung, auch nicht mit Passkey
          before: async (session) => {
            const state = await accountState(session.userId);
            if (!state || state.locked) throw new APIError("FORBIDDEN", { message: "Dieser Zugang ist gesperrt." });
          },
          // Jede Anmeldung steht im Audit-Log, mit Rolle und Art
          after: async (session, ctx) => {
            const state = await accountState(session.userId);
            if (state) await recordLogin(session.userId, state.role, loginMethod(ctx?.path));
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
