import { passkey } from "@better-auth/passkey";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { count } from "drizzle-orm";
import { db, schema } from "./db/index.ts";
import { env } from "./env.ts";

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
    plugins: [
      passkey({ rpID: baseUrl.hostname, rpName: "Haben", origin: baseUrl.origin }),
      tanstackStartCookies(),
    ],
    databaseHooks: {
      user: {
        create: {
          // Haben hat genau einen Nutzer.
          before: async (user) => {
            const [row] = await db.select({ n: count() }).from(schema.user);
            if ((row?.n ?? 0) > 0) {
              throw new APIError("FORBIDDEN", { message: "Haben ist bereits eingerichtet." });
            }
            return { data: user };
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
