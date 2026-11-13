import { CONTACT_FIELDS, type DatevContactPlan, type DatevGpRow, type DatevStockContact, datevContactCandidates, planDatevContacts } from "@haben/import";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { type Db, schema, type Tx } from "../../db/index.ts";
import { ContactError, contactSchema } from "./contacts.ts";
import { insertImportedContacts, validated } from "./csv-import.ts";

/*
 * Kontakte aus DATEV-Stammdaten „Debitoren/Kreditoren“ (docs/csv-import.md, „Kontakte aus DATEV“): Planen und Zusammenführen
 * macht @haben/import (csv-import/datev-kontakte.ts), hier kommen das Schema des Formulars, der Bestand samt exportierter
 * Nummern (datev_personenkonten) und das Schreiben in der Transaktion des Aufrufers dazu.
 */

export type DatevContactImportPlan = DatevContactPlan<z.output<typeof contactSchema>>;

/** Alle Kontakte, auch archivierte, mit dem Vermerk, welche Nummer schon in einem DATEV-Export steht */
async function stock(q: Db | Tx): Promise<DatevStockContact[]> {
  const exported = (rolle: "debitor" | "kreditor") =>
    sql<boolean>`exists (select 1 from datev_personenkonten p where p.contact_id = contacts.id and p.rolle = ${rolle})`;
  const rows = await q
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      kundennummer: schema.contacts.kundennummer,
      ustId: schema.contacts.ustId,
      debitorNr: schema.contacts.debitorNr,
      kreditorNr: schema.contacts.kreditorNr,
      debitorFest: exported("debitor"),
      kreditorFest: exported("kreditor"),
      archivedAt: schema.contacts.archivedAt,
    })
    .from(schema.contacts);
  return rows.map(({ archivedAt, ...c }) => ({ ...c, archived: archivedAt !== null }));
}

export async function planDatevContactImport(q: Db | Tx, rows: readonly DatevGpRow[]): Promise<DatevContactImportPlan[]> {
  const candidates = datevContactCandidates(rows).map((row) =>
    validated(row, (c) => contactSchema.safeParse({ ...c, defaultFormat: null, language: "de" }), CONTACT_FIELDS),
  );
  return planDatevContacts(candidates, await stock(q));
}

/**
 * Neue Kontakte anlegen und bestätigten Vorschlägen die Nummer geben, mit der Rolle dazu (ein Debitor macht zum Kunden,
 * ein Kreditor zum Lieferanten). Nur leere Nummern werden gesetzt; die Version erhöht der Trigger wie bei jeder Änderung.
 */
export async function applyDatevContactImport(
  tx: Tx,
  plan: readonly DatevContactImportPlan[],
  confirmed: ReadonlySet<number>,
): Promise<{ created: number; assigned: number }> {
  const created = await insertImportedContacts(
    tx,
    plan.flatMap((p) => (p.status === "neu" ? [p.value] : [])),
  );
  let assigned = 0;
  for (const p of plan) {
    if (p.status !== "zuordnen" || !confirmed.has(p.line)) continue;
    const { contactId, debitorNr, kreditorNr } = p.assign;
    const updated = await tx
      .update(schema.contacts)
      .set({ ...(debitorNr === null ? {} : { debitorNr, isCustomer: true }), ...(kreditorNr === null ? {} : { kreditorNr, isSupplier: true }) })
      .where(
        and(
          eq(schema.contacts.id, contactId),
          debitorNr === null ? undefined : isNull(schema.contacts.debitorNr),
          kreditorNr === null ? undefined : isNull(schema.contacts.kreditorNr),
        ),
      )
      .returning({ id: schema.contacts.id });
    if (updated.length === 0) throw new ContactError(`Zeile ${p.line}: Der Kontakt hat inzwischen ein Personenkonto. Lade die Vorschau neu.`);
    assigned++;
  }
  return { created, assigned };
}
