import { naechstesPersonenkonto, PERSONENKONTO_BEREICH, PERSONENKONTO_LABEL, type PersonenkontoRolle } from "@haben/core";
import { eq, inArray, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema, type Tx } from "../../db/index.ts";
import { ContactError } from "./contacts.ts";

/*
 * Fehlende DATEV-Personenkonten vergeben (#327): automatisch, wenn ein Kontakt für den Export einen Debitor bzw. Kreditor
 * braucht und keinen hat. Die Sperre der Firmenzeile reiht gleichzeitige Vergaben hintereinander, wie bei den
 * Kundennummern (customer-numbers.ts); wer danach kommt, sieht die Nummer schon am Kontakt. Wiederverwendet wird keine
 * Nummer, die je an einem Kontakt stand (contact_versions) oder exportiert wurde (datev_personenkonten).
 */

export const personenkontoKey = (contactId: string, rolle: PersonenkontoRolle) => `${contactId}:${rolle}`;

const COLUMN = { debitor: "debitor_nr", kreditor: "kreditor_nr" } as const;

async function vergebeneNummern(tx: Tx, rolle: PersonenkontoRolle): Promise<Set<number>> {
  const column = sql.raw(COLUMN[rolle]);
  const rows = await tx.execute<{ nr: number }>(sql`
    select ${column} as nr from contacts where ${column} is not null
    union select (data->>${COLUMN[rolle]})::int from contact_versions where data->>${COLUMN[rolle]} is not null
    union select nummer from datev_personenkonten where rolle = ${rolle}`);
  return new Set(rows.map((r) => Number(r.nr)));
}

/** Nummer je Kontakt und Rolle (Schlüssel personenkontoKey): die vorhandene, sonst eine neu vergebene */
export async function vergibPersonenkonten(actor: string, wanted: readonly { contactId: string; rolle: PersonenkontoRolle }[]): Promise<Map<string, number>> {
  return withActor(actor, async (tx) => {
    await tx.select({ id: schema.company.id }).from(schema.company).where(eq(schema.company.id, 1)).for("update");
    const result = new Map<string, number>();
    for (const rolle of ["debitor", "kreditor"] as const) {
      const ids = [...new Set(wanted.filter((w) => w.rolle === rolle).map((w) => w.contactId))];
      if (ids.length === 0) continue;
      const column = rolle === "debitor" ? schema.contacts.debitorNr : schema.contacts.kreditorNr;
      const current = new Map(
        (await tx.select({ id: schema.contacts.id, nr: column }).from(schema.contacts).where(inArray(schema.contacts.id, ids))).map((c) => [c.id, c.nr]),
      );
      const vergeben = await vergebeneNummern(tx, rolle);
      for (const id of ids.filter((i) => current.has(i))) {
        let nr = current.get(id) ?? null;
        if (nr === null) {
          nr = naechstesPersonenkonto(rolle, vergeben);
          if (nr === null) {
            const { von, bis } = PERSONENKONTO_BEREICH[rolle];
            throw new ContactError(`Keine freie ${PERSONENKONTO_LABEL[rolle]}nummer mehr (${von} bis ${bis}).`);
          }
          vergeben.add(nr);
          await tx
            .update(schema.contacts)
            .set(rolle === "debitor" ? { debitorNr: nr } : { kreditorNr: nr })
            .where(eq(schema.contacts.id, id));
        }
        result.set(personenkontoKey(id, rolle), nr);
      }
    }
    return result;
  });
}
