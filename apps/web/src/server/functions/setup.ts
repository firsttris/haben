import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { count } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { listCustomPages } from "../modules/eigene-seiten/index.ts";
import { firmaInNavigation, navMark } from "../../lib/navigation.ts";
import { hasEmployees } from "../modules/lohn/index.ts";
import { loadCompany, logoInfo } from "../modules/stammdaten/index.ts";
import { env } from "../env.ts";
import { andereFirmen } from "../../lib/firmen.ts";
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
    // Zeichen der Firma (#504), getrennt von der Beleggestaltung; das Logo nur auf ausdrückliche Wahl
    zeichen: company ? navMark({ color: company.navColor, logo: company.navLogo }, company.navLogo ? ((await logoInfo())?.sha256 ?? null) : null) : null,
    // Eigene Seiten (#199) als Menüeinträge des Inhabers, ebenfalls erst nach der Anmeldung
    eigeneSeiten: user?.role === "inhaber" ? (await listCustomPages()).map(({ id, name, url, openInNewTab }) => ({ id, name, url, openInNewTab })) : [],
    // Menüpunkt SV-Meldeportal erst mit dem ersten Mitarbeiter; die Steuerberatung hat ihre eigene Navigation
    hatMitarbeiter: user?.role === "inhaber" ? await hasEmployees() : false,
    // Firma wechseln (#504): die Instanzen der anderen Firmen, nur für den Inhaber
    firmen: user ? andereFirmen(env().HABEN_FIRMEN, env().BETTER_AUTH_URL, user.role) : [],
    // Mit Portal (#504, Stufe 2) führt „Firma wechseln“ dorthin, ebenfalls nur für den Inhaber
    portal: user?.role === "inhaber" ? (env().HABEN_PORTAL_URL ?? null) : null,
  };
});
