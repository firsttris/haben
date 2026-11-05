import { darf, isRolle, type Rolle, type Zugriff } from "../lib/rollen.ts";
import { auth } from "./auth.ts";

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
 * Das angemeldete Konto zur Anfrage, oder null ohne gültige Sitzung. Ein gesperrtes Konto oder eines ohne bekannte
 * Rolle gilt als nicht angemeldet; Sperren löscht die Sitzungen zwar, das hier hält auch ohne das.
 */
export async function sessionUser(headers: Headers): Promise<SessionUser | null> {
  const session = await auth().api.getSession({ headers });
  if (!session) return null;
  const { id, name, email, role, lockedAt } = session.user as typeof session.user & { role?: unknown; lockedAt?: unknown };
  if (lockedAt || !isRolle(role)) return null;
  return { id, name, email, role };
}

/**
 * Für API-Routen: das Konto, wenn es angemeldet ist und `zugriff` hat; sonst die Antwort 401 bzw. 403.
 * Mit `instanceof Response` prüft die Route, was zurückkam.
 */
export async function requireUser(request: Request, zugriff: Zugriff): Promise<SessionUser | Response> {
  const user = await sessionUser(request.headers);
  if (!user) return new Response("Nicht angemeldet", { status: 401 });
  if (!darf(user.role, zugriff)) return new Response("Nur für den Inhaber", { status: 403 });
  return user;
}
