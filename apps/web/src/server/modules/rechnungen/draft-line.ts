import { invoiceLineInputSchema, LINE_DETAIL_MAX } from "@haben/core";
import { z } from "zod";

/**
 * Position mit der mehrzeiligen Beschreibung unter der Bezeichnung; gleich für Rechnung, Angebot und wiederkehrende
 * Rechnung. Eigene Datei ohne weitere Abhängigkeiten: quotes.ts und recurring.ts bauen ihre Schemas beim Laden daraus,
 * auch wenn invoices.ts über einen Importkreis noch nicht fertig geladen ist.
 */
export const draftLineSchema = z.object({ ...invoiceLineInputSchema.shape, detail: z.string().trim().max(LINE_DETAIL_MAX).default("") });
