import { UserError } from "../../errors.ts";

/**
 * Eine Eingabe oder ein Zustand, den die Jahreserklärung ablehnt. Der Text geht so an die Oberfläche, deshalb
 * steht der Fehler in einem eigenen Modul: `annual.ts` und `zeilenwerte.ts` brauchen ihn beide, ohne dass eines
 * vom anderen abhängt.
 */
export class AnnualError extends UserError {}
