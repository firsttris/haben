import type { UmsatzStand } from "../rechnungen/index.ts";

/**
 * Für Tests, die festschreiben: `kleinunternehmerStand`, erst beim Aufruf geladen. Die Testdateien laden die Module erst
 * nach `setupTestDb`; ein Import von `index.ts` beim Laden der Datei fände die Umgebung der Datenbank noch nicht.
 */
export const kleinunternehmerStand: UmsatzStand = async (heute, foundedOn, tx) =>
  (await import("./kleinunternehmer.ts")).kleinunternehmerStand(heute, foundedOn, tx);
