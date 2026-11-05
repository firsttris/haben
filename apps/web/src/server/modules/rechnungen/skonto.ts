import { MAX_SKONTO_STUFEN, SKONTO_STUFEN_MAX_MESSAGE, skontoStufeSchema, sortSkonto, type SkontoStufe } from "@haben/core";
import { z } from "zod";

/**
 * Skonto eines Rechnungsentwurfs, ohne Angabe keins. Eigene Datei ohne weitere Abhängigkeiten wie draft-line.ts, damit
 * die Schemas von Rechnung und wiederkehrender Rechnung sie beim Laden nutzen können.
 */
export const draftSkontoSchema = z.array(z.object(skontoStufeSchema.shape)).max(MAX_SKONTO_STUFEN, SKONTO_STUFEN_MAX_MESSAGE).default([]);

/**
 * Vorgabe für eine neue Rechnung: das Skonto des Kunden, sonst das aus den Firmendaten. Stufen, deren Frist länger
 * ist als das Zahlungsziel dieser Rechnung, entfallen; nach der Fälligkeit gibt es kein Skonto.
 */
export function defaultSkonto(
  company: { skonto: SkontoStufe[] },
  contact: { skonto: SkontoStufe[] | null } | null | undefined,
  paymentTermDays: number,
): SkontoStufe[] {
  return sortSkonto(contact?.skonto ?? company.skonto).filter((s) => s.days <= paymentTermDays);
}
