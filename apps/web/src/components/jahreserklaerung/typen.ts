import type { getAnnualReturns } from "../../server/functions/annual.ts";

/** Was die Seite der Jahreserklärung lädt */
export type Data = Awaited<ReturnType<typeof getAnnualReturns>>;
