import { formatDocumentNumber, numberFormatError } from "@haben/core";
import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { today } from "../../today.ts";
import { loadCompany } from "./company.ts";

/*
 * Kundennummern automatisch beim Anlegen eines Kontakts ohne eigene Nummer. Anders als Rechnungsnummern müssen sie nicht
 * lückenlos sein; der Zähler läuft durch und überspringt Nummern, die ein Kontakt schon trägt (von Hand oder aus einem
 * Import). Die Sperre der Firmenzeile reiht gleichzeitiges Anlegen hintereinander.
 */

export class CustomerNumberError extends UserError {}

export async function customerNumbering(): Promise<{ format: string; next: number; preview: string | null }> {
  const { customerNumberFormat: format, customerNumberNext: next } = await loadCompany(db);
  // Dieselbe Suche wie beim Anlegen, damit die Vorschau vergebene Nummern auch überspringt
  return { format, next, preview: format ? formatDocumentNumber(format, today(), await firstFree(db, format, next)) : null };
}

export async function saveCustomerNumbering(actor: string, input: { format: string; next: number }): Promise<void> {
  const format = input.format.trim();
  const problem = format ? numberFormatError(format, { requireYear: false }) : null;
  if (problem) throw new CustomerNumberError(`Format der Kundennummer: ${problem}`);
  if (!Number.isInteger(input.next) || input.next < 1) throw new CustomerNumberError("Die nächste Kundennummer muss mindestens 1 sein.");
  await loadCompany();
  await withActor(actor, (tx) =>
    tx.update(schema.company).set({ customerNumberFormat: format, customerNumberNext: input.next, updatedAt: new Date() }).where(eq(schema.company.id, 1)),
  );
}

/**
 * Kundennummer für einen neuen Kontakt in der laufenden Transaktion: die eigene, sonst die nächste freie; null = keine
 * automatische Vergabe. Sperrt die Firmenzeile auch bei eigener Nummer, sonst sähe eine gleichzeitige Vergabe die noch
 * nicht festgeschriebene Nummer nicht und vergäbe sie ein zweites Mal.
 */
export async function takeCustomerNumber(tx: Tx, own: string | null): Promise<string | null> {
  const [company] = await tx
    .select({ format: schema.company.customerNumberFormat, next: schema.company.customerNumberNext })
    .from(schema.company)
    .where(eq(schema.company.id, 1))
    .for("update");
  if (own) return own;
  if (!company?.format) return null;
  const counter = await firstFree(tx, company.format, company.next);
  await tx
    .update(schema.company)
    .set({ customerNumberNext: counter + 1 })
    .where(eq(schema.company.id, 1));
  return formatDocumentNumber(company.format, today(), counter);
}

/** Erster Zähler ab `start`, dessen Nummer noch kein Kontakt trägt */
async function firstFree(q: Db | Tx, format: string, start: number): Promise<number> {
  let counter = start;
  while (await taken(q, formatDocumentNumber(format, today(), counter))) counter++;
  return counter;
}

async function taken(q: Db | Tx, number: string): Promise<boolean> {
  const [row] = await q.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.kundennummer, number)).limit(1);
  return Boolean(row);
}
