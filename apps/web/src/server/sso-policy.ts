import { APIError, type GenericEndpointContext } from "better-auth";
import { getSessionFromCtx } from "better-auth/api";
import { eq } from "drizzle-orm";
import { isRolle, type Rolle } from "../lib/rollen.ts";
import { authDatabase } from "./auth-transaction.ts";
import { schema } from "./db/index.ts";
import { env } from "./env.ts";

/*
 * Zwei strikt getrennte Betriebsarten. Einziger Schalter ist OIDC_ONLY aus der validierten Serverkonfiguration, nie
 * Browserdaten: im Standardmodus nur lokale Anmeldung (Passwort, Passkey, Einladungen), im SSO-Modus nur OIDC mit
 * Rollen aus den Gruppen des OIDC-Anbieters.
 */
export const ssoOnly = () => env().OIDC_ONLY;

/** Better-Auth-Endpunkte der lokalen Anmeldung und Kontenpflege; im SSO-Modus gesperrt */
export const LOCAL_AUTH_PATHS = [
  "/sign-in/email",
  "/sign-up/email",
  "/change-password",
  "/set-password",
  "/verify-password",
  "/request-password-reset",
  "/reset-password",
  "/forget-password",
  "/change-email",
  "/delete-user",
  "/link-social",
  "/unlink-account",
];

/** Better-Auth-Endpunkte von OIDC; im Standardmodus gesperrt. Verknüpfen gibt es in keiner Betriebsart. */
const OIDC_PATHS = ["/sign-in/social", "/link-social", "/unlink-account"];

/** Diese Endpunkte würden Provider-Tokens verarbeiten oder ausgeben; Haben speichert keine */
const TOKEN_PATHS = ["/get-access-token", "/refresh-token", "/account-info"];

export function pathAllowed(path: string | undefined, sso: boolean): boolean {
  if (!path) return true;
  if (TOKEN_PATHS.includes(path)) return false;
  if (sso) return !LOCAL_AUTH_PATHS.includes(path) && !path.startsWith("/passkey/") && !path.startsWith("/sign-in/passkey");
  return !OIDC_PATHS.includes(path) && !path.startsWith("/callback/");
}

/** Felder einer Better-Auth-Sitzung, die über die Betriebsart entscheiden */
export interface SessionProof {
  oidcIssuer?: string | null;
  ssoRole?: string | null;
  ssoExpiresAt?: Date | string | null;
}

interface AccountFields {
  role?: unknown;
  lockedAt?: unknown;
}

/**
 * Die wirksame Rolle einer Sitzung, oder null, wenn sie in der laufenden Betriebsart nicht gilt. Standardmodus: nur
 * lokale Sitzungen, lokale Rolle, keine Sperre. SSO-Modus: nur Sitzungen dieses Issuers mit bestätigter Rolle und
 * nicht abgelaufener Frist; lokale Rolle und Sperre zählen dort nicht. So entwertet ein Moduswechsel jede Sitzung.
 */
export function effectiveRole(session: SessionProof | undefined, account: AccountFields, now = Date.now()): Rolle | null {
  if (!ssoOnly()) {
    if (session?.oidcIssuer != null || account.lockedAt) return null;
    return isRolle(account.role) ? account.role : null;
  }
  if (!session || session.oidcIssuer !== env().OIDC_ISSUER || !isRolle(session.ssoRole) || !session.ssoExpiresAt) return null;
  return new Date(session.ssoExpiresAt).getTime() > now ? session.ssoRole : null;
}

/** Auch direkte Aufrufe nativer Better-Auth-Endpunkte halten die Betriebsart ein, nicht nur die Oberfläche */
export async function enforceMode(ctx: GenericEndpointContext): Promise<void> {
  const sso = ssoOnly();
  if (!pathAllowed(ctx.path, sso)) {
    throw new APIError("FORBIDDEN", { message: sso ? "Im SSO-Modus gibt es nur die Anmeldung über SSO." : "SSO ist nicht eingeschaltet." });
  }
  if (ctx.path === "/sign-in/social" || ctx.path?.startsWith("/callback/") || ctx.path === "/sign-out") return;
  // Kein Cookie-Cache und kein Refresh vor der Prüfung: eine fremde oder abgelaufene Sitzung verlängert sich so nicht
  const current = await getSessionFromCtx(ctx, { disableCookieCache: true, disableRefresh: true });
  if (current && !effectiveRole(current.session as SessionProof, current.user as AccountFields)) {
    await authDatabase().delete(schema.session).where(eq(schema.session.id, current.session.id));
    throw new APIError("UNAUTHORIZED", { message: sso ? "Bitte erneut über SSO anmelden." : "Bitte erneut anmelden." });
  }
}
