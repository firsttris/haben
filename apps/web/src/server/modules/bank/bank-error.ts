import { UserError } from "../../errors.ts";

/** Fehler des Bankmoduls, die die Person lesen soll; eigene Datei, damit kleine Teile ohne Datenbank sie nutzen können */
export class BankError extends UserError {}
