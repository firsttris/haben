import { AssetError, SteuernummerError } from "@haben/core";
import { EInvoiceParseError } from "@haben/einvoice";
import { ElsterEingabeError, EricInstallError } from "@haben/elster";
import { DatevParseError, EnableBankingApiError, LexofficeApiError, StatementParseError } from "@haben/import";
import { ZodError } from "zod";

/** Fachfehler, deren Meldung der Nutzer sehen soll. Alles andere wird zentral als „Interner Fehler“ ausgegeben. */
export class UserError extends Error {}

/** Fehler der Pakete, deren Meldung ebenfalls für den Nutzer bestimmt ist */
const PACKAGE_USER_ERRORS = [
  AssetError,
  SteuernummerError,
  EInvoiceParseError,
  EricInstallError,
  ElsterEingabeError,
  DatevParseError,
  EnableBankingApiError,
  LexofficeApiError,
  StatementParseError,
];

/** Postgres 23505 auf dem genannten Index; Drizzle verpackt den Fehler des Treibers in `cause` */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = (error as { cause?: { code?: string; constraint_name?: string } } | null)?.cause;
  return pg?.code === "23505" && pg.constraint_name === constraint;
}

export const INTERNAL_ERROR = "Interner Fehler. Details stehen im Server-Log.";

function issueText(issues: readonly { message: string }[]): string {
  return [...new Set(issues.map((issue) => issue.message))].join("; ") || "Ungültige Eingabe.";
}

/** Der Validator von TanStack Start wirft bei Zod-Schemas einen Error mit den Issues als JSON. */
function validatorIssues(error: Error): string | undefined {
  if (error.constructor !== Error || !error.message.startsWith("[")) return undefined;
  try {
    const issues: unknown = JSON.parse(error.message);
    if (Array.isArray(issues) && issues.length > 0 && issues.every((issue) => typeof issue?.message === "string")) return issueText(issues);
  } catch {
    // kein JSON
  }
  return undefined;
}

/**
 * Meldung eines unserer Trigger (RAISE EXCEPTION in drizzle/*.sql): Sie ist für Menschen geschrieben, etwa „Im Jahr 2026
 * gibt es schon Buchungen …“. Erkennbar am Code raise_exception (P0001) oder check_violation (23514) ohne Namen einer
 * Constraint; Verletzungen von CHECK-Constraints tragen einen Namen und bleiben intern. Drizzle verpackt den Fehler
 * des Treibers in `cause`.
 */
function triggerMessage(error: unknown): string | undefined {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    // Fehler des Treibers erkennbar an severity und code (nicht am Klassennamen, der beim Bündeln verloren gehen kann)
    const pg = candidate as { severity?: unknown; code?: unknown; constraint_name?: unknown; message?: unknown } | null;
    if (typeof pg?.severity !== "string" || typeof pg.code !== "string" || typeof pg.message !== "string") continue;
    if (pg.code === "P0001" || (pg.code === "23514" && !pg.constraint_name)) return pg.message;
  }
  return undefined;
}

/** Meldung, die der Browser sehen darf; undefined bei internen Fehlern (SQL, Dateipfade, Stack). */
export function userMessage(error: unknown): string | undefined {
  if (error instanceof UserError || PACKAGE_USER_ERRORS.some((type) => error instanceof type)) return (error as Error).message;
  const fromTrigger = triggerMessage(error);
  if (fromTrigger) return fromTrigger;
  if (error instanceof ZodError) return issueText(error.issues);
  if (error instanceof Error) return validatorIssues(error);
  return undefined;
}
