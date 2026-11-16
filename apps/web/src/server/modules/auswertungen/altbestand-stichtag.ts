import { takeoverCutoff, takeoverCutoffConflict, takeoverCutoffIssue, type TakeoverCutoff } from "@haben/core";
import { and, isNull, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { today } from "../../today.ts";
import { activeOpenings } from "../buchhaltung/index.ts";
import { loadCompany } from "../stammdaten/index.ts";

export class TakeoverError extends UserError {}

export async function lastStapelYear(q: Db | Tx): Promise<number | null> {
  const [row] = await q.select({ last: sql<string | null>`max(${schema.datevBookings.date})` }).from(schema.datevBookings);
  return row?.last ? Number(row.last.slice(0, 4)) : null;
}

async function lastVoucherDate(q: Db | Tx): Promise<string | null> {
  const [row] = await q.select({ last: sql<string | null>`max(${schema.lexofficeVouchers.date})::text` }).from(schema.lexofficeVouchers);
  return row?.last ?? null;
}

/**
 * Buchungstag der ersten Übernahme eines offenen Postens: die früheste Buchung einer übernommenen Rechnung bzw. eines
 * übernommenen Belegs. Andere Buchungen haben diese Quellen nicht (Zahlungen buchen über die Zuordnung, Korrekturen als
 * eigene Rechnung); Stornobuchungen zählen nicht.
 */
async function firstTakeoverDate(q: Db | Tx): Promise<string | null> {
  const e = schema.journalEntries;
  const [row] = await q
    .select({ first: sql<string | null>`min(${e.date})::text` })
    .from(e)
    .where(
      and(
        isNull(e.reversesId),
        sql`(${e.sourceType} = 'invoice' and exists (select 1 from ${schema.invoices} i where i.id = ${e.sourceId} and i.lexoffice_voucher_id is not null))
          or (${e.sourceType} = 'document' and exists (select 1 from ${schema.documents} d where d.id = ${e.sourceId} and d.lexoffice_voucher_id is not null))`,
      ),
    );
  return row?.first ?? null;
}

/**
 * Stichtag der Übernahme aus Firmendaten, Journal und Archiv (takeoverCutoff in @haben/core). Ein gewählter Stichtag
 * gilt nur, wenn weder eine Eröffnung noch die erste Übernahme noch bei GmbH und UG der DATEV-Stapel ihn festlegt; weicht
 * er von dem der ersten Übernahme ab, lehnt Haben ihn ab.
 */
export async function legacyTakeoverCutoff(requested?: string | null, q: Db | Tx = db): Promise<TakeoverCutoff> {
  const [company, openings, stapelYear, lastVoucher, firstTakeover] = await Promise.all([
    loadCompany(q),
    activeOpenings(q),
    lastStapelYear(q),
    lastVoucherDate(q),
    firstTakeoverDate(q),
  ]);
  const input = {
    rechtsform: company.rechtsform,
    openingDate: openings[0]?.date ?? null,
    stapelYear,
    lastVoucherDate: lastVoucher,
    firstTakeoverDate: firstTakeover,
    today: today(),
  };
  const cutoff = takeoverCutoff(input);
  if (!requested) return cutoff;
  const conflict = takeoverCutoffConflict(requested, input);
  if (conflict) throw new TakeoverError(conflict);
  if (cutoff.fixed) return cutoff;
  const issue = takeoverCutoffIssue(requested, company.rechtsform, input.today);
  if (issue) throw new TakeoverError(issue);
  return takeoverCutoff({ ...input, requested });
}
