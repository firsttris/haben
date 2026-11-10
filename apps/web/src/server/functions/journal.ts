import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createManualEntry, knownAccounts, loadJournal, manualEntrySchema, reverseManualEntry } from "../modules/buchhaltung/index.ts";
import { bookDatevEroeffnung, datevEroeffnung, datevEroeffnungSchema } from "../modules/archiv/index.ts";
import { checkCashReversal } from "../modules/bank/index.ts";
import { journalAbJahr, loadCompany } from "../modules/stammdaten/index.ts";
import { authMiddleware, readMiddleware } from "../middleware.ts";
import { today } from "../today.ts";
import { yearSchema } from "./schemas.ts";

/** Buchungen eines Monats mit ihren Zeilen, nur lesend */
export const getJournal = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(z.object({ year: yearSchema, month: z.number().int().min(1).max(12) }))
  .handler(({ data }) => loadJournal(data.year, data.month));

/**
 * Was das Formular für eine manuelle Buchung braucht: Rechtsform, Kontenrahmen, Stichjahr und Stand als Kleinunternehmer
 * (freie Buchungen), die bekannten Kontonamen und, wenn es einen archivierten DATEV-Stapel gibt, den Vorschlag für die
 * Eröffnung aus seiner Schlussbilanz
 */
export const getManualEntryForm = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const company = await loadCompany();
    return {
      today: today(),
      kontenrahmen: company.kontenrahmen,
      rechtsform: company.rechtsform,
      kleinunternehmer: company.kleinunternehmer,
      journalAb: await journalAbJahr(),
      accounts: knownAccounts(company.kontenrahmen),
      datevEroeffnung: await datevEroeffnung(today()),
    };
  });

/** Manuelle Buchung (GmbH, UG; ab dem Stichjahr auch im Einzelunternehmen und mit Steuerschlüssel); die Prüfung macht das Modul */
export const createManualEntryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(manualEntrySchema)
  .handler(async ({ data, context }) => ({ id: await createManualEntry(context.user.id, data, today()) }));

export const reverseManualEntryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => ({ id: await reverseManualEntry(context.user.id, data, checkCashReversal) }));

/** Eröffnung aus der Schlussbilanz des DATEV-Stapels buchen, so wie der Nutzer den Vorschlag gesehen hat */
export const bookDatevEroeffnungFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(datevEroeffnungSchema)
  .handler(async ({ data, context }) => ({ id: await bookDatevEroeffnung(context.user.id, data, today()) }));
