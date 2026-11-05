/*
 * Rollen der Zugänge (Roadmap Platz 10, Stufe 1), ohne Serverbezug: Server (Middleware, API-Routen) und Oberfläche
 * (Navigation, Umleitung) nehmen dieselben Regeln.
 */

/** Der Inhaber (genau einer, alle Rechte) und die Steuerberatung (nur lesen) */
export const ROLLEN = ["inhaber", "steuerberatung"] as const;
export type Rolle = (typeof ROLLEN)[number];

export const ROLLEN_LABEL: Record<Rolle, string> = { inhaber: "Inhaber", steuerberatung: "Steuerberatung" };

/** „inhaber“: alles Schreibende, Einstellungen, Geheimnisse (Vorgabe). „lesen“: Auswertungen, Journal, Konten, Belege, Rechnungen, Exporte */
export type Zugriff = "inhaber" | "lesen";

export const isRolle = (value: unknown): value is Rolle => typeof value === "string" && (ROLLEN as readonly string[]).includes(value);

/** Ob eine Rolle den Zugriff hat. Unbekannte Rollen haben gar keinen. */
export function darf(role: string, zugriff: Zugriff): boolean {
  if (role === "inhaber") return true;
  return role === "steuerberatung" && zugriff === "lesen";
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Seiten der Steuerberatung; alle anderen leiten auf ihre Startseite um. Der Server prüft unabhängig davon jede Anfrage. */
const STEUERBERATUNG_SEITEN = [
  /^\/steuerberatung$/,
  /^\/auswertungen$/,
  /^\/buchungen$/,
  /^\/konten$/,
  /^\/konten\/\d{4,8}$/,
  /^\/belege$/,
  new RegExp(`^/belege/${UUID}$`, "i"),
  /^\/rechnungen$/,
  new RegExp(`^/rechnungen/${UUID}$`, "i"),
];

/** Startseite der Steuerberatung */
export const STEUERBERATUNG_START = "/steuerberatung";

export function steuerberatungSieht(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return STEUERBERATUNG_SEITEN.some((pattern) => pattern.test(path));
}
