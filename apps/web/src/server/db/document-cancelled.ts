import { sql, type SQL } from "drizzle-orm";
import * as schema from "./schema.ts";

/**
 * Bedingung für Abfragen auf `documents`: der Beleg ist nicht storniert (#237). Ein stornierter Beleg bleibt gebucht und
 * gesperrt; was ihn aufhebt, steht in `document_cancellations`. Offene Posten, Zahlungen und Kategorievorschläge lassen
 * ihn deshalb weg, Voranmeldung und EÜR zählen den Storno als eigene Zeile am Datum der Gegenbuchung.
 */
export function documentNotCancelled(bis?: string): SQL {
  // Im Abschlussstand (#1110) fällt nur weg, was bis zum Stichtag storniert war. Maßgeblich ist das Buchungsdatum der
  // Gegenbuchung, wie bei den Restlaufzeiten (`restlaufzeiten.ts`): Der Storno gehört in den Zeitraum, in den er
  // zurückdatiert ist, nicht in den, in dem jemand ihn erfasst. Der Stand am Stichtag stimmt damit mit dem Journal
  // überein, nicht mit dem, was damals tatsächlich als Verbindlichkeit bestand.
  return sql`not exists (select 1 from ${schema.documentCancellations}
    where ${schema.documentCancellations.documentId} = ${schema.documents.id}${bis ? sql` and ${schema.documentCancellations.date} <= ${bis}` : sql``})`;
}
