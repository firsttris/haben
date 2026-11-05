/*
 * Zugänge (Roadmap Platz 10, Stufe 1): Einladungen für die Steuerberatung, Konten sperren und entfernen, Änderungen seit
 * dem letzten Besuch. Rollen, Sitzung und Einlösen der Einladung stehen in der Infrastruktur (server/rollen.ts,
 * server/anmeldung.ts), weil Better Auth und die Middleware sie brauchen.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export {
  createInvitation,
  EINLADUNG_GUELTIG_STUNDEN,
  invitationInputSchema,
  listInvitations,
  revokeInvitation,
  ZugangError,
  type InvitationStatus,
} from "./einladungen.ts";
export { listAccounts, lockAccount, recentLogins, removeAccount, unlockAccount } from "./zugaenge.ts";
export { changesSince, changesSinceLastVisit, type Aenderungen } from "./aenderungen.ts";
