import { formatDocumentNumber, numberFormatError } from "@haben/core";
import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
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
  return { format, next, preview: format ? formatDocumentNumber(format, Number(today().slice(0, 4)), next) : null };
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

/** Nächste freie Kundennummer in der laufenden Transaktion, null = keine automatische Vergabe */
export async function takeCustomerNumber(tx: Tx): Promise<string | null> {
  const [company] = await tx
    .select({ format: schema.company.customerNumberFormat, next: schema.company.customerNumberNext })
    .from(schema.company)
    .where(eq(schema.company.id, 1))
    .for("update");
  if (!company?.format) return null;
  const year = Number(today().slice(0, 4));
  let counter = company.next;
  while (await taken(tx, formatDocumentNumber(company.format, year, counter))) counter++;
  await tx
    .update(schema.company)
    .set({ customerNumberNext: counter + 1 })
    .where(eq(schema.company.id, 1));
  return formatDocumentNumber(company.format, year, counter);
}

async function taken(tx: Tx, number: string): Promise<boolean> {
  const [row] = await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.kundennummer, number)).limit(1);
  return Boolean(row);
}
