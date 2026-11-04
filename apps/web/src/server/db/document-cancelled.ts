import { sql, type SQL } from "drizzle-orm";
import * as schema from "./schema.ts";

/**
 * Bedingung für Abfragen auf `documents`: der Beleg ist nicht storniert (#237). Ein stornierter Beleg bleibt gebucht und
 * gesperrt; was ihn aufhebt, steht in `document_cancellations`. Offene Posten, Zahlungen und Kategorievorschläge lassen
 * ihn deshalb weg, Voranmeldung und EÜR zählen den Storno als eigene Zeile am Tag des Stornos.
 */
export function documentNotCancelled(): SQL {
  return sql`not exists (select 1 from ${schema.documentCancellations} where ${schema.documentCancellations.documentId} = ${schema.documents.id})`;
}
