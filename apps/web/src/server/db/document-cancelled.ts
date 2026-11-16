import { sql, type SQL } from "drizzle-orm";
import * as schema from "./schema.ts";

/**
 * Bedingung für Abfragen auf `documents`: der Beleg ist nicht storniert (#237). Ein stornierter Beleg bleibt gebucht und
 * gesperrt; was ihn aufhebt, steht in `document_cancellations`. Offene Posten, Zahlungen und Kategorievorschläge lassen
 * ihn deshalb weg, Voranmeldung und EÜR zählen den Storno als eigene Zeile am Datum der Gegenbuchung.
 */
export function documentNotCancelled(bis?: string): SQL {
  // Im Abschlussstand (#1110) fällt nur weg, was bis zum Stichtag schon storniert war. Maßgeblich ist der Tag des
  // Stornos, nicht seine Gegenbuchung: Die darf in den offenen Zeitraum zurückdatiert sein (`cancellationDate`),
  // die Verbindlichkeit bestand am Stichtag trotzdem.
  return sql`not exists (select 1 from ${schema.documentCancellations}
    where ${schema.documentCancellations.documentId} = ${schema.documents.id}${
      bis ? sql` and (${schema.documentCancellations.createdAt} at time zone 'Europe/Berlin')::date <= ${bis}` : sql``
    })`;
}
