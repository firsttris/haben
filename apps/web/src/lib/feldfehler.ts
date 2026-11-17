import { createSerializationAdapter } from "@tanstack/react-router";

/**
 * Überträgt einen Fehler mit den Feldern eines Fachfehlers (`clientError` in server/errors.ts) samt `felder` zum Browser:
 * Ohne diesen Adapter (eingetragen in start.ts) überträgt TanStack Start von einem Fehler nur die Meldung
 */
export const feldfehlerAdapter = createSerializationAdapter({
  key: "haben/feldfehler",
  test: (value): value is Error & { felder: string[] } => value instanceof Error && Array.isArray((value as { felder?: unknown }).felder),
  toSerializable: (error) => ({ message: error.message, felder: error.felder }),
  fromSerializable: ({ message, felder }) => Object.assign(new Error(message), { felder }),
});
