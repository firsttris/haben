import { UserError } from "../../errors.ts";

/** Fehler beim Einrichten oder Versenden von E-Mails, mit Meldung für den Nutzer */
export class MailError extends UserError {}
