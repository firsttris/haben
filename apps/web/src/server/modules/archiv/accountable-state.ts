import type { AccountableExport, AccountableMapping } from "@haben/import";
import { UserError } from "../../errors.ts";
import type { AccountableProgress } from "../../db/schema.ts";

/** Fehler im Accountable-Umzug; die Oberfläche zeigt die Meldung unverändert an. */
export class AccountableError extends UserError {}

/** Grenze wie beim Archiv; ein Export je Geschäftsjahr liegt weit darunter. */
export const MAX_ACCOUNTABLE_SIZE = 100 * 1024 * 1024;

/** Höchstens so viele offene Posten stehen in der Meldung; die Zahl bleibt vollständig. */
export const OPEN_ITEM_LIMIT = 50;

/** Was die Analyse ermittelt; so steht es am Lauf, damit die Oberfläche es ohne erneutes Entpacken zeigen kann. */
export type AccountableAnalysis = AccountableProgress;

/** Was ein Upload im Speicher des Servers hinterlässt; der Lauf liest daraus. */
export interface StagedExport {
  filename: string;
  bytes: Uint8Array;
  export: AccountableExport;
  mapping: AccountableMapping;
  analysis: AccountableAnalysis;
}

// Nur im Speicher: ein Upload legt keine Datei in Haben an, erst der Lauf. Ein neuer Upload ersetzt den vorigen.
let staged: StagedExport | null = null;

export const stagedExport = () => staged;
export const stageExport = (upload: StagedExport | null) => {
  staged = upload;
};

/** Läufe, die gerade im Prozess laufen; ein Neustart des Servers macht sie zu abgebrochenen Läufen. */
export const running = new Set<string>();
export const cancelled = new Set<string>();
