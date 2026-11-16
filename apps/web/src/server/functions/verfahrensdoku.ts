import { createServerFn } from "@tanstack/react-start";
import { loadProcedureDetails, procedureDetailsSchema, procedureDocument, saveProcedureDetails } from "../modules/verfahrensdoku/index.ts";
import { authMiddleware } from "../middleware.ts";

/** Verfahrensdokumentation aus der Instanz und die gespeicherten Angaben zum Betrieb (Einstellungen › Export) */
export const getProcedureDocument = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const [document, details] = await Promise.all([procedureDocument(), loadProcedureDetails()]);
    return { document, details };
  });

/** Angaben zum Betrieb speichern; jede Änderung steht im Änderungsprotokoll */
export const saveProcedureDetailsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(procedureDetailsSchema)
  .handler(async ({ data, context }) => {
    await saveProcedureDetails(context.user.id, data);
  });
