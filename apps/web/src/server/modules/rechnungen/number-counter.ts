import {
  circleKey,
  counterCircle,
  customerNumberProblem,
  documentNumberLengthProblem,
  formatDocumentNumber,
  usesCustomerNumber,
  voucherField,
  type FinalizedCircleRef,
} from "@haben/core";
import { and, asc, desc, eq, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

/*
 * Nummernkreise für Rechnungen und Angebote, lückenlos je Kreis. Ein Kreis ist das Jahr des Belegdatums oder, wenn der
 * Zähler in den Einstellungen durchläuft, der eine Kreis 0 (counterCircle, #328); beim Zähler je Kunde trägt jeder
 * Kontakt einen eigenen Kreis (contact_id der Zählertabelle, NULL = gemeinsamer Kreis wie bisher, #1426). Die
 * Funktionen unten nehmen den Kreis.
 *
 * Das Festschreiben erzeugt PDF und XML mit der neuen Nummer. Jede Änderung mit Audit-Eintrag nimmt die Sperre der
 * Hash-Kette bis zum Commit (drizzle/0063), und solange warten alle anderen Schreibvorgänge. Deshalb wird die Nummer
 * zuerst nur gelesen (peekNumber, unter einer eigenen Sperre je Kreis und Jahr), dann entstehen PDF und XML, und erst
 * danach schreibt takeNumber den Zähler. Die Kette ist so nur für das Speichern gesperrt, nicht für das Rendern.
 *
 * Reihenfolge der Sperren: Rechnungszeilen (FOR UPDATE), dann Nummernkreis, dann die Kette. Wer in einer Transaktion
 * schon etwas mit Audit-Eintrag geschrieben hat und danach eine Nummer braucht (Storno: erst der Entwurf), sperrt die
 * betroffenen Zeilen und den Kreis vorher (lockNumbering), sonst können sich zwei Transaktionen gegenseitig blockieren.
 */

export type NumberKind = "rechnung" | "angebot";

const COUNTERS = {
  rechnung: schema.invoiceNumberCounters,
  angebot: schema.quoteNumberCounters,
} as const;

const NUMBERED = {
  rechnung: schema.invoices,
  angebot: schema.quotes,
} as const;

export class NumberTakenError extends UserError {}

/** {KUNDENNR} im Format, aber der Beleg hat keine verwendbare Kundennummer */
export class NumberCustomerError extends UserError {}

/** Nummer länger, als DATEV sie als Belegnummer übernimmt (#1426) */
export class NumberLengthError extends UserError {}

/** Nummer sieht im DATEV-Belegfeld 1 aus wie eine vergebene (#1426) */
export class NumberCollisionError extends UserError {}

/** Ob der Zähler des Kreises durchläuft; nur gelesen, ohne die Firmenzeile anzulegen (loadCompany schriebe Audit) */
export async function countsRunning(tx: Tx, kind: NumberKind): Promise<boolean> {
  const column = kind === "rechnung" ? schema.company.invoiceCounterRunning : schema.company.quoteCounterRunning;
  const [row] = await tx.select({ running: column }).from(schema.company).where(eq(schema.company.id, 1));
  return row?.running ?? false;
}

/** Ob der Zähler dieser Art je Kunde kreist; nur gelesen, ohne die Firmenzeile anzulegen (loadCompany schriebe Audit) */
export async function countsPerCustomer(tx: Tx, kind: NumberKind): Promise<boolean> {
  const column = kind === "rechnung" ? schema.company.invoiceCounterPerCustomer : schema.company.quoteCounterPerCustomer;
  const [row] = await tx.select({ perCustomer: column }).from(schema.company).where(eq(schema.company.id, 1));
  return row?.perCustomer ?? false;
}

/** Kontakt des Kreises beim Festschreiben: beim Zähler je Kunde der Kunde, sonst der gemeinsame Kreis (NULL, #1426) */
export function circleContact(perCustomer: boolean, contactId: string): string | null {
  return perCustomer ? contactId : null;
}

/**
 * Name eines anderen Kontakts mit derselben Kundennummer, sonst null. Kreist der Zähler je Kunde, steht die Kundennummer
 * für genau einen Kreis: zwei Kontakte mit derselben Nummer dürfen dann nicht beide Belege bekommen (#1426).
 */
export async function customerNumberConflict(tx: Tx, contact: { id: string; kundennummer: string | null }): Promise<string | null> {
  if (!contact.kundennummer) return null;
  const [other] = await tx
    .select({ name: schema.contacts.name })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.kundennummer, contact.kundennummer), ne(schema.contacts.id, contact.id)))
    .limit(1);
  return other?.name ?? null;
}

/** Kreis für ein Belegdatum, nach der Einstellung des Kreises */
export async function circleFor(tx: Tx, kind: NumberKind, date: string): Promise<number> {
  return counterCircle(await countsRunning(tx, kind), date);
}

/**
 * Nummer im Format aus den Einstellungen. Ein Format ergibt nie zweimal dieselbe Nummer (number-format.ts), nach einem
 * Wechsel des Formats kann sie aber mit einer früher vergebenen übereinstimmen; dann lieber eine klare Meldung als die
 * Verletzung des Unique-Index.
 */
export async function documentNumber(tx: Tx, kind: NumberKind, format: string, date: string, counter: number, customerNumber?: string): Promise<string> {
  // Vor allem Schreiben: ohne verwendbare Kundennummer darf {KUNDENNR} nicht zur Nummer werden
  if (usesCustomerNumber(format)) {
    const problem = customerNumberProblem(customerNumber);
    if (problem) throw new NumberCustomerError(problem);
  }
  const number = formatDocumentNumber(format, date, counter, customerNumber);
  // DATEV liest im Belegfeld 1 nur 36 Zeichen: eine längere Nummer könnte dort mit einer anderen zusammenfallen;
  // Angebote exportiert DATEV nicht
  if (kind === "rechnung") {
    const problem = documentNumberLengthProblem(number);
    if (problem) throw new NumberLengthError(problem);
  }
  const table = NUMBERED[kind];
  const [taken] = await tx.select({ id: table.id }).from(table).where(eq(table.number, number)).limit(1);
  if (taken) {
    throw new NumberTakenError(`Die Nummer ${number} ist schon vergeben. Bitte unter Einstellungen › Rechnungen das Nummernformat anpassen.`);
  }
  return number;
}

type CounterContactColumn = typeof schema.invoiceNumberCounters.contactId | typeof schema.quoteNumberCounters.contactId;

/** Kreis-Bedingung der Zählertabelle: NULL ist der gemeinsame Kreis, sonst der Kontakt des Kundenkreises (#1426) */
function contactCondition(column: CounterContactColumn, contactId: string | null): SQL | undefined {
  return contactId === null ? isNull(column) : eq(column, contactId);
}

/** Sperrt einen Nummernkreis bis zum Ende der Transaktion; mehrfach aufrufbar */
export async function lockNumbering(tx: Tx, kind: NumberKind, year: number, contactId: string | null): Promise<void> {
  // Der gemeinsame Kreis behält seinen bisherigen Schlüssel, Kundenkreise hängen den Kontakt an (#1426)
  const lockKey = `haben.nummernkreis.${kind}.${year}${contactId === null ? "" : `.${contactId}`}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
}

/** Letzte vergebene Nummer des Kreises (0 = noch keine), unter der Sperre des Kreises gelesen */
export async function lastNumber(tx: Tx, kind: NumberKind, year: number, contactId: string | null): Promise<number> {
  const counter = COUNTERS[kind];
  const [row] = await tx
    .select({ last: counter.last })
    .from(counter)
    .where(and(eq(counter.year, year), contactCondition(counter.contactId, contactId)));
  return row?.last ?? 0;
}

/** Nächste Nummer, ohne sie zu verbrauchen. Sperrt den Kreis bis zum Commit; bis dahin vergibt niemand eine Nummer. */
export async function peekNumber(tx: Tx, kind: NumberKind, year: number, contactId: string | null): Promise<number> {
  await lockNumbering(tx, kind, year, contactId);
  return (await lastNumber(tx, kind, year, contactId)) + 1;
}

/** Verbraucht die mit peekNumber gelesene Nummer. Schlägt fehl, wenn der Zähler inzwischen woanders steht. */
export async function takeNumber(tx: Tx, kind: NumberKind, year: number, number: number, contactId: string | null): Promise<void> {
  const counter = COUNTERS[kind];
  const [row] = await tx
    .insert(counter)
    .values({ year, last: number, contactId })
    .onConflictDoUpdate({ target: [counter.year, counter.contactId], set: { last: number }, setWhere: eq(counter.last, number - 1) })
    .returning({ last: counter.last });
  if (!row) throw new Error(`Nummernkreis ${kind} ${year}${contactId === null ? "" : `:${contactId}`}: Nummer ${number} ist nicht mehr die nächste.`);
}

/** Vergibt die Rechnungsnummer und prüft unter der Audit-Sperre auch kreisübergreifend auf DATEV-Kollisionen. */
export async function takeInvoiceNumber(tx: Tx, year: number, counter: number, number: string, contactId: string | null): Promise<void> {
  // Der Audit-Trigger des Zählers sperrt die Hash-Kette bis zum Commit. Erst danach lesen, damit auch parallel
  // festgeschriebene Nummern aus anderen Kreisen sichtbar sind. Bei Kollision rollt der Zähler mit zurück.
  await takeNumber(tx, "rechnung", year, counter, contactId);
  const field = voucherField(number);
  const { invoices } = schema;
  const rows = await tx.select({ number: invoices.number }).from(invoices).where(isNotNull(invoices.number));
  const clash = rows.find((row) => row.number !== null && voucherField(row.number) === field);
  if (clash) {
    throw new NumberCollisionError(
      `Die Nummer ${number} sieht im DATEV-Export aus wie die vergebene Nummer ${clash.number}; im Belegfeld 1 stehen beide als „${field}“. Bitte unter Einstellungen › Rechnungen das Nummernformat oder die Kundennummer anpassen.`,
    );
  }
}

/** Die Nummerneinstellungen haben sich zwischen dem Lesen und dem Schreiben der Nummer geändert (#1426) */
export class NumberSettingsChangedError extends UserError {}

/**
 * Nach takeNumber, also unter der Sperre der Hash-Kette: Gelten Format und Kreis noch, mit denen die Nummer gebildet
 * wurde? Sonst rollt das Festschreiben zurück. Eine Nummer nach den alten Einstellungen fehlte dem Kreis, den das
 * Umschalten schon gestartet hat (seedCustomerCircles, startRunning), und er gäbe sie noch einmal aus (#1426).
 */
export async function assertNumberingCurrent(
  tx: Tx,
  kind: NumberKind,
  used: { format: string; date: string; year: number; contactId: string | null },
  customerId: string,
): Promise<void> {
  const { company } = schema;
  const [row] = await tx
    .select(
      kind === "rechnung"
        ? { format: company.invoiceNumberFormat, running: company.invoiceCounterRunning, perCustomer: company.invoiceCounterPerCustomer }
        : { format: company.quoteNumberFormat, running: company.quoteCounterRunning, perCustomer: company.quoteCounterPerCustomer },
    )
    .from(company)
    .where(eq(company.id, 1));
  if (
    row &&
    (row.format !== used.format || counterCircle(row.running, used.date) !== used.year || circleContact(row.perCustomer, customerId) !== used.contactId)
  ) {
    throw new NumberSettingsChangedError("Die Nummernkreise wurden gerade in den Einstellungen geändert. Bitte noch einmal festschreiben.");
  }
}

/** Setzt den Zähler so, dass `next` die nächste Nummer ist (Umstieg von einem anderen Programm) */
export async function setNextNumber(
  tx: Tx,
  kind: NumberKind,
  year: number,
  next: number,
  contactId: string | null,
): Promise<{ ok: true } | { ok: false; last: number }> {
  await lockNumbering(tx, kind, year, contactId);
  const last = await lastNumber(tx, kind, year, contactId);
  if (next <= last) return { ok: false, last };
  const counter = COUNTERS[kind];
  await tx
    .insert(counter)
    .values({ year, last: next - 1, contactId })
    .onConflictDoUpdate({ target: [counter.year, counter.contactId], set: { last: next - 1 } });
  return { ok: true };
}

/**
 * Beim Umschalten auf den durchlaufenden Zähler: Er beginnt hinter der letzten Nummer des jüngsten Jahres desselben
 * Kreises, damit „RE-2026-12-0412“ im Januar mit 0413 weitergeht. Steht der Kreis 0 schon (früher einmal
 * durchlaufend), rückt er nur vor, wenn das jüngste Jahr inzwischen weiter ist; sonst ergäbe ein Format mit Jahr eine
 * schon vergebene Nummer.
 */
export async function startRunning(tx: Tx, kind: NumberKind, contactId: string | null): Promise<void> {
  const counter = COUNTERS[kind];
  await lockNumbering(tx, kind, 0, contactId);
  const [latest] = await tx
    .select({ last: counter.last })
    .from(counter)
    .where(and(sql`${counter.year} > 0`, contactCondition(counter.contactId, contactId)))
    .orderBy(sql`${counter.year} desc`)
    .limit(1);
  await tx
    .insert(counter)
    .values({ year: 0, last: latest?.last ?? 0, contactId })
    .onConflictDoUpdate({ target: [counter.year, counter.contactId], set: { last: sql`excluded.last` }, setWhere: sql`${counter.last} < excluded.last` });
}

/**
 * Beim Umschalten auf den Zähler je Kunde: Jeder Kontakt beginnt hinter der höchsten Nummer, die seine
 * festgeschriebenen Belege im gemeinsamen Kreis schon verbraucht haben — beim Format mit {KUNDENNR} ergäbe sonst die
 * nächste Nummer eine vergebene (#1426). Wie startRunning rückt die Zeile nur vor: War der Kundenkreis aus einem
 * früheren Einschalten schon weiter, bleibt der höhere Stand.
 *
 * Erst lesen, wenn die Hash-Kette gesperrt ist: Eine Rechnung, die im gemeinsamen Kreis gerade ihre Nummer geschrieben
 * hat, hält die Kette bis zum Commit, und ihre Nummer zählt hier mit. Wer die Kette erst danach bekommt, sieht die neue
 * Einstellung und rollt zurück (assertNumberingCurrent). Den durchlaufenden gemeinsamen Kreis sperrt das vorher, weil
 * startCircles ihn danach braucht und wer dort zählt, nach seinem Kreis auf die Kette wartet. Die Kundenkreise kommen
 * hier ausnahmsweise nach der Kette: Solange der Zähler je Kunde aus war, zählt niemand in ihnen.
 */
export async function seedCustomerCircles(tx: Tx, kind: NumberKind, running: boolean): Promise<void> {
  const numbered = NUMBERED[kind];
  const counter = COUNTERS[kind];
  await lockNumbering(tx, kind, 0, null);
  await tx.execute(sql`select haben_lock_audit_chain()`);
  // Durchlaufende Altbelege tragen Kreis 0. Für einen Jahreskreis zählt ihr Belegjahr.
  const year = running
    ? numbered.numberYear
    : sql<number>`case when ${numbered.numberYear} = 0 then extract(year from ${numbered.issueDate})::smallint else ${numbered.numberYear} end`;
  const rows = await tx
    .select({ year, contactId: numbered.contactId, last: sql<number>`max(${numbered.numberCounter})` })
    .from(numbered)
    .where(
      and(
        eq(numbered.status, "final"),
        isNotNull(numbered.numberYear),
        isNotNull(numbered.numberCounter),
        isNull(numbered.numberContactId),
        isNotNull(numbered.contactId),
      ),
    )
    .groupBy(year, numbered.contactId)
    .orderBy(asc(year), asc(numbered.contactId));
  // Je Kreis unter seiner Sperre, damit zwei Umschaltungen nicht aneinander vorbei schreiben
  for (const row of rows) {
    await lockNumbering(tx, kind, row.year!, row.contactId!);
    await tx
      .insert(counter)
      .values({ year: row.year!, last: row.last, contactId: row.contactId })
      .onConflictDoUpdate({
        target: [counter.year, counter.contactId],
        set: { last: sql`excluded.last` },
        setWhere: sql`${counter.last} < excluded.last`,
      });
  }
}

/** Kontakte mit eigener Zählerzeile dieser Art — die Kundenkreise, die beim Zähler je Kunde entstanden sind (#1426) */
export async function counterContacts(tx: Tx, kind: NumberKind): Promise<string[]> {
  const counter = COUNTERS[kind];
  const rows = await tx.selectDistinct({ contactId: counter.contactId }).from(counter).where(isNotNull(counter.contactId));
  return rows.map((r) => r.contactId!);
}

/**
 * Zuletzt festgeschriebene Rechnung je Nummernkreis, für die Datumsprüfung beim Festschreiben (#713). Der Schlüssel ist
 * der Kreis: das Jahr, beim Kundenkreis Jahr:Kontakt (circleKey, #1426).
 */
export async function lastFinalizedByCircle(q: Db | Tx = db): Promise<Record<string, FinalizedCircleRef>> {
  const rows = await q
    .selectDistinctOn([schema.invoices.numberYear, schema.invoices.numberContactId], {
      numberYear: schema.invoices.numberYear,
      numberContactId: schema.invoices.numberContactId,
      number: schema.invoices.number,
      issueDate: schema.invoices.issueDate,
    })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.status, "final"),
        isNotNull(schema.invoices.numberYear),
        isNotNull(schema.invoices.numberCounter),
        isNotNull(schema.invoices.number),
      ),
    )
    .orderBy(asc(schema.invoices.numberYear), asc(schema.invoices.numberContactId), desc(schema.invoices.numberCounter));
  return Object.fromEntries(rows.map((r) => [circleKey(r.numberYear!, r.numberContactId), { number: r.number!, issueDate: r.issueDate }]));
}
