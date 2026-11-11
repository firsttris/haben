import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { count } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { listCustomPages } from "../modules/eigene-seiten/index.ts";
import { firmaInNavigation } from "../../lib/navigation.ts";
import { hasEmployees } from "../modules/lohn/index.ts";
import { loadCompany } from "../modules/stammdaten/index.ts";
import { env } from "../env.ts";
import { firmenSicht } from "../../lib/firmen.ts";
import { oidcPublicConfig } from "../oidc.ts";
import { ssoInitialized } from "../sso-callback.ts";
import { ssoOnly } from "../sso-policy.ts";
import { sessionUser } from "../rollen.ts";

/** Eingerichtet heißt im Standardmodus: es gibt ein Konto. Im SSO-Modus: ein Inhaber hat sich für diesen Issuer angemeldet. */
async function initialized(): Promise<boolean> {
  if (ssoOnly()) return ssoInitialized(db, env().OIDC_ISSUER!);
  const [row] = await db.select({ n: count() }).from(schema.user);
  return (row?.n ?? 0) > 0;
}

/** Öffentlich: Betriebsart, ob Haben schon eingerichtet ist und ob jemand angemeldet ist. */
export const getAuthState = createServerFn({ method: "GET" }).handler(async () => {
  const user = await sessionUser(getRequestHeaders());
  const company = user ? await loadCompany() : null;
  return {
    oidc: oidcPublicConfig(),
    initialized: await initialized(),
    user: user ? { name: user.name, email: user.email, role: user.role } : null,
    // Für die Navigation: eine GmbH oder UG hat keine Pauschalen; erst nach der Anmeldung
    rechtsform: company?.rechtsform ?? null,
    // Mehrere Firmen (#504): in welcher Instanz man gerade arbeitet, für alle Rollen dieser Instanz
    firma: company ? firmaInNavigation(company.name) : null,
    // Eigene Seiten (#199) als Menüeinträge des Inhabers, ebenfalls erst nach der Anmeldung
    eigeneSeiten: user?.role === "inhaber" ? (await listCustomPages()).map(({ id, name }) => ({ id, name })) : [],
    // Menüpunkt SV-Meldeportal erst mit dem ersten Mitarbeiter; die Steuerberatung hat ihre eigene Navigation
    hatMitarbeiter: user?.role === "inhaber" ? await hasEmployees() : false,
    // Firmen wechseln (#504): Name der eigenen Firma, die übrigen nur für den Inhaber
    firmen: user ? firmenSicht(env().HABEN_FIRMEN, env().BETTER_AUTH_URL, user.role) : { aktuell: null, andere: [] },
  };
});
