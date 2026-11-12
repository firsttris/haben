import { isAPIError } from "better-auth/api";
import { darf, type Rolle, type Zugriff } from "../lib/rollen.ts";
import { auth, authContextReady } from "./auth.ts";
import { effectiveRole, ssoOnly, type SessionProof } from "./sso-policy.ts";

/*
 * Rechte der Zugänge an einer Stelle. Jede Server Function und jede API-Route mit Sitzung sagt, welchen Zugriff sie
 * braucht: „inhaber“ (Vorgabe, alles Schreibende, Einstellungen, Geheimnisse) oder „lesen“ (Auswertungen, Journal,
 * Kontenblätter, Belege und Rechnungen ansehen, Exporte). Die Steuerberatung hat nur „lesen“.
 */

export { darf, type Zugriff };

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Rolle;
}

/**
 * Das angemeldete Konto zur Anfrage mit seiner wirksamen Rolle, oder null ohne gültige Sitzung. Im Standardmodus ist das
 * die lokale Rolle eines ungesperrten Kontos, im SSO-Modus nur die beim letzten Callback bestätigte Rolle, solange deren
 * Frist läuft (sso-policy.ts). Navigation, Server Functions, API-Routen und Audit sehen so dieselbe Rolle.
 */
export async function sessionUser(headers: Headers): Promise<SessionUser | null> {
  // Ein hängender Anbieter beim ersten Aufbau darf nicht jede Seite aufhalten; die Anmeldeseite meldet die Störung
  if (ssoOnly() && !(await authContextReady())) return null;
  let session;
  try {
    session = await auth().api.getSession({ headers });
  } catch (error) {
    // Abgelaufene oder fremde Sitzung: der Before-Hook hat sie gelöscht, das gilt als nicht angemeldet
    if (isAPIError(error) && error.status === "UNAUTHORIZED") return null;
    throw error;
  }
  if (!session) return null;
  const role = effectiveRole(session.session as SessionProof | undefined, session.user as { role?: unknown; lockedAt?: unknown });
  if (!role) return null;
  const { id, name, email } = session.user;
  return { id, name, email, role };
}

/**
 * Das Konto zur Anfrage, wenn es angemeldet ist und `zugriff` hat; sonst die Antwort 401 bzw. 403. Routen nehmen
 * `requireUser` (nur Inhaber) oder `lesend` (lese-route.ts), nicht diese Funktion selbst.
 */
export async function pruefeZugriff(request: Request, zugriff: Zugriff): Promise<SessionUser | Response> {
  const user = await sessionUser(request.headers);
  if (!user) return new Response("Nicht angemeldet", { status: 401 });
  if (!darf(user.role, zugriff)) return new Response("Nur für den Inhaber", { status: 403 });
  return user;
}

/**
 * Für API-Routen nur des Inhabers: das Konto, wenn es angemeldet ist und Inhaber ist; sonst die Antwort 401 bzw. 403.
 * Mit `instanceof Response` prüft die Route, was zurückkam. Was auch die Steuerberatung abruft, steht in `lesend`
 * (lese-route.ts), damit es im Nur-Lesen-Rahmen läuft.
 */
export function requireUser(request: Request, zugriff: "inhaber"): Promise<SessionUser | Response> {
  return pruefeZugriff(request, zugriff);
}
