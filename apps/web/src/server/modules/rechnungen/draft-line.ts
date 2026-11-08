import { discountSchema, invoiceLineInputSchema, LINE_DETAIL_MAX, QUOTE_LINE_KINDS } from "@haben/core";
import { z } from "zod";

/**
 * Position mit der mehrzeiligen Beschreibung unter der Bezeichnung; gleich für Rechnung, Angebot und wiederkehrende
 * Rechnung. Eigene Datei ohne weitere Abhängigkeiten: quotes.ts und recurring.ts bauen ihre Schemas beim Laden daraus,
 * auch wenn invoices.ts über einen Importkreis noch nicht fertig geladen ist.
 */
export const draftLineSchema = z.object({
  ...invoiceLineInputSchema.shape,
  detail: z.string().trim().max(LINE_DETAIL_MAX).default(""),
  /** Artikelnummer des Verkäufers (BT-155), aus dem Artikel kopiert; EN 16931 nennt keine Höchstlänge (#388) */
  itemNumber: z.string().trim().max(100, "Artikelnummer höchstens 100 Zeichen").default(""),
});

/** Position einer Rechnung mit Positionsrabatt (Prozent oder Betrag im Preismodus); wiederkehrende Rechnungen haben keinen */
export const invoiceDraftLineSchema = draftLineSchema.extend({ discount: z.nullable(discountSchema).default(null) });

/** Position eines Angebots: dazu optional oder Alternative zur Hauptposition davor (null = normale Position) */
export const quoteDraftLineSchema = invoiceDraftLineSchema.extend({ kind: z.enum(QUOTE_LINE_KINDS).nullable().default(null) });
