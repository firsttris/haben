import { evatrMeldung } from "@haben/core";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { type ArchiveFile, berlinStart, csv, iso } from "./export.ts";

/*
 * Bestätigungen ausländischer USt-IdNrn. beim BZSt (#1385) im Jahresarchiv, nach dem Zeitpunkt der Anfrage in deutscher
 * Zeit. Der empfangene Datensatz ist der Nachweis (UStAE 18e.1 Abs. 2) und steht unverändert in der Spalte „Antwort“.
 */

export const USTID_BESTAETIGUNGEN_HEADER = [
  "Zeitpunkt",
  "Kontakt",
  "Art",
  "Angefragte USt-IdNr.",
  "Eigene USt-IdNr.",
  "Name gesendet",
  "Straße gesendet",
  "PLZ gesendet",
  "Ort gesendet",
  "Status",
  "Meldung",
  "Gültig ab",
  "Gültig bis",
  "Name",
  "Straße",
  "PLZ",
  "Ort",
  "BZSt-ID",
  "Antwort",
  "Angefragt von",
  "Kontakt-ID",
  "ID",
];

export async function* ustIdBestaetigungFiles(year: number): AsyncGenerator<ArchiveFile> {
  const b = schema.ustidBestaetigungen;
  const rows = await db
    .select({ bestaetigung: b, kontakt: schema.contacts.name })
    .from(b)
    .innerJoin(schema.contacts, eq(schema.contacts.id, b.contactId))
    .where(and(gte(b.anfrageZeitpunkt, berlinStart(year)), lt(b.anfrageZeitpunkt, berlinStart(year + 1))))
    .orderBy(asc(b.anfrageZeitpunkt), asc(b.createdAt), asc(b.id));
  if (!rows.length) return;
  yield {
    path: "stammdaten/ustid-bestaetigungen.csv",
    content: csv(
      USTID_BESTAETIGUNGEN_HEADER,
      rows.map(({ bestaetigung: z, kontakt }) => [
        iso(z.anfrageZeitpunkt),
        kontakt,
        z.art,
        z.angefragteUstid,
        z.anfragendeUstid,
        z.firmenname,
        z.strasse,
        z.plz,
        z.ort,
        z.status,
        evatrMeldung(z),
        z.gueltigAb,
        z.gueltigBis,
        z.ergFirmenname,
        z.ergStrasse,
        z.ergPlz,
        z.ergOrt,
        z.bzstId,
        z.antwort,
        z.createdBy,
        z.contactId,
        z.id,
      ]),
    ),
    compress: true,
  };
}
