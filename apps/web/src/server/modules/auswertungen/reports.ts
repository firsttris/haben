import { isKapitalgesellschaft, type Cents, type EuerResult, LOHN_ZAHLUNGEN, documentOpen, periodKey, postenOf, vatPostenLabel } from "@haben/core";
import { and, eq, gte, inArray, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { loadCompany } from "../stammdaten/index.ts";
import { euerAusDemJournal } from "./euer-quelle.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { documentNotCancelled } from "../../db/document-cancelled.ts";
import { listInvoices, paidByTarget } from "../rechnungen/index.ts";
import { today as todayInGermany } from "../../today.ts";
import { ustvaPosten } from "../umsatzsteuer/index.ts";
import { advanceOpenPositions } from "./advance-open-positions.ts";

/** Umsätze in den zehn Tagen um einen Jahreswechsel des Jahres (22.12. bis 10.01.), deren Zuordnung `art` erfüllt */
async function zahlungenUmJahreswechsel(year: number, art: SQL | undefined, q: Db | Tx): Promise<number> {
  const fenster = (y: number) => and(gte(schema.bankTransactions.bookingDate, `${y - 1}-12-22`), lte(schema.bankTransactions.bookingDate, `${y}-01-10`));
  const [row] = await q
    .select({ n: sql<number>`count(distinct ${schema.allocations.transactionId})`.mapWith(Number) })
    .from(schema.allocations)
    .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.allocations.transactionId))
    .where(
      and(
        art,
        // Aufgehobene Zuordnungen zählen nicht: weder die Gegenzeile noch die aufgehobene Zeile selbst
        isNull(schema.allocations.reversesId),
        sql`not exists (select 1 from allocations r where r.reverses_id = ${schema.allocations.id})`,
        or(fenster(year), fenster(year + 1)),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Lohnzahlungen in den zehn Tagen um einen Jahreswechsel des Jahres (22.12. bis 10.01.). Regelmäßig wiederkehrende Ausgaben
 * gehören dann in das Jahr, zu dem sie wirtschaftlich gehören (§ 11 Abs. 2 Satz 2 EStG, etwa die Lohnsteuer für Dezember,
 * fällig am 10. Januar nach § 41a Abs. 1 EStG). Welchem Monat eine Zahlung gilt, weiß Haben nicht; es zählt sie am Tag
 * der Zahlung und weist auf sie hin.
 */
export async function lohnZahlungenUmJahreswechsel(year: number, q: Db | Tx = db): Promise<number> {
  return zahlungenUmJahreswechsel(year, inArray(schema.allocations.kind, [...LOHN_ZAHLUNGEN]), q);
}

/**
 * Umsatzsteuer früherer Jahre (Steuerzahlung) in den zehn Tagen um einen Jahreswechsel. Eine Abschlusszahlung aus der
 * Jahreserklärung zählt im Jahr der Zahlung; ist es aber die Vorauszahlung für Dezember bzw. das vierte Quartal, gehört sie
 * als Voranmeldung zugeordnet. Dann zählt die EÜR sie im Vorjahr, wenn sie dort fällig war (§ 11 Abs. 2 Satz 2 EStG,
 * euer-jahreswechsel.ts).
 */
export async function umsatzsteuerVorjahreUmJahreswechsel(year: number, q: Db | Tx = db): Promise<number> {
  return zahlungenUmJahreswechsel(
    year,
    and(eq(schema.allocations.kind, "steuer"), eq(schema.allocations.taxType, "ust"), eq(schema.allocations.taxItem, "steuer")),
    q,
  );
}

/**
 * Die EÜR eines Jahres aus dem Journal (#542, #1116, euer-quelle.ts). GmbH und UG bilanzieren (#567); ihre Übersicht nach
 * Zahlung kommt ebenso aus dem Journal, ohne manuelle Buchungen: Das sind dort Abschlussbuchungen wie Rückstellungen, keine
 * Zahlung.
 */
export async function euerForYear(year: number, q: Db | Tx = db): Promise<EuerResult> {
  return euerAusDemJournal(year, q, { ohneManuelle: isKapitalgesellschaft((await loadCompany(q)).rechtsform) });
}

/**
 * Umsatz eines Monats (`JJJJ-MM`) netto für die Kachel der Übersicht: Saldo der Konten im Posten „1. Umsatzerlöse“ der
 * GuV (§ 277 Abs. 1 HGB, Zuordnung nach dem DATEV-Kontenrahmen, postenOf) nach Buchungsdatum, in Einzelunternehmen
 * und GmbH gleich. Rechnungen aus Haben sind gebucht und zählen mit, ebenso Buchungen aus dem Datenimport (#1116);
 * Stornos, Gutschriften und Erlösschmälerungen mindern. Zinsen, Mahn- und Kurserträge sind sonstige Erträge und fehlen.
 */
export async function umsatzImMonat(monat: string, q: Db | Tx = db): Promise<Cents> {
  const teile = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monat);
  if (!teile) throw new Error(`Monat ${monat} ist nicht JJJJ-MM`);
  const [jahr, m] = [Number(teile[1]), Number(teile[2])];
  const bis = m === 12 ? `${jahr + 1}-01-01` : `${jahr}-${String(m + 1).padStart(2, "0")}-01`;
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const rows = await q
    .select({ kontenrahmen: e.kontenrahmen, account: l.account, haben: sql<string>`sum(${l.credit} - ${l.debit})` })
    .from(l)
    .innerJoin(e, eq(l.entryId, e.id))
    .where(and(gte(e.date, `${monat}-01`), lt(e.date, bis), ne(e.sourceType, "eroeffnung")))
    .groupBy(e.kontenrahmen, l.account);
  return rows.filter((r) => postenOf(r.kontenrahmen, r.account) === "umsatzerloese").reduce((sum, r) => sum + Number(r.haben), 0);
}

export interface OpenPosition {
  id: string;
  number: string;
  party: string;
  date: string;
  dueDate: string;
  gross: number;
  open: number;
  /** Tage seit Fälligkeit; 0 = heute fällig, negativ = noch nicht fällig */
  daysOverdue: number;
  /** Neues Bilanzverfahren: Anforderung, bilanzierter Anspruch, Papierzwischenraum oder echte Anzahlungs-Erstattung. */
  balanceKind?: "request" | "receivable" | "unbilled" | "refund";
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Offene Forderungen: festgeschriebene Rechnungen, die die Rechnungsliste als offen zeigt; `bis` ist der Stichtag des Abschlussstands (#1110) */
async function openReceivables(today: string, bis: string | undefined, separate: Set<string>): Promise<OpenPosition[]> {
  return (await listInvoices(today, undefined, db, bis))
    .filter((i) => i.status === "final" && i.open !== 0 && !separate.has(i.id))
    .map((i) => ({
      id: i.id,
      number: i.number ?? "",
      party: i.customer,
      date: i.issueDate,
      dueDate: i.dueDate,
      gross: i.gross,
      open: i.open,
      daysOverdue: daysBetween(i.dueDate, today),
    }));
}

/** Offene Verbindlichkeiten: gebuchte, über die Bank zu zahlende Belege, die es am Stichtag schon gab und nicht storniert waren */
async function openPayables(today: string, bis: string | undefined): Promise<OpenPosition[]> {
  const documents = await db
    .select({
      id: schema.documents.id,
      number: schema.documents.invoiceNumber,
      supplier: schema.documents.supplierName,
      filename: schema.documents.filename,
      documentDate: schema.documents.documentDate,
      dueDate: schema.documents.dueDate,
      uploadedAt: schema.documents.uploadedAt,
      gross: schema.documents.gross,
    })
    .from(schema.documents)
    // Storniert ist nichts mehr zu zahlen (#237); im Abschlussstand erst, wenn das Storno bis zum Stichtag erklärt war (#1110)
    .where(
      and(
        eq(schema.documents.status, "gebucht"),
        eq(schema.documents.payment, "bank"),
        documentNotCancelled(bis),
        // Belege, die es am Stichtag noch nicht gab, stehen im Abschlussstand nicht (#1110)
        bis ? sql`coalesce(${schema.documents.documentDate}, (${schema.documents.uploadedAt} at time zone 'Europe/Berlin')::date) <= ${bis}` : undefined,
      ),
    );
  // „Offen“ heißt überall dasselbe: bezahlt rechnet paidByTarget, wie Rechnungsliste und Bankabgleich (#1110)
  const documentPaid = await paidByTarget(
    "document_id",
    documents.map((d) => d.id),
    db,
    bis,
  );
  return documents
    .map((d) => {
      const date = d.documentDate ?? todayInGermany(d.uploadedAt);
      const dueDate = d.dueDate ?? date;
      // Zuordnungen tragen das Vorzeichen des Kontos (Ausgang negativ)
      return {
        id: d.id,
        number: d.number || d.filename,
        party: d.supplier || "–",
        date,
        dueDate,
        gross: d.gross,
        // Als Verbindlichkeit positiv; documentOpen rechnet mit dem Vorzeichen des Kontos
        open: -documentOpen(d.gross, documentPaid.get(d.id) ?? 0),
        daysOverdue: daysBetween(dueDate, today),
      };
    })
    .filter((d) => d.open !== 0);
}

/** Zahllast (positiv) und Erstattung (negativ) abgegebener Voranmeldungen; id ist der Zeitraum für den Link */
async function openVatPosten(today: string, bis: string | undefined): Promise<OpenPosition[]> {
  return (await ustvaPosten(db, { bis })).posten
    .filter((p) => p.offen !== 0)
    .map((p) => ({
      id: periodKey(p),
      number: `${vatPostenLabel(p)}${p.berichtigt ? " (Berichtigung)" : ""}`,
      party: "Finanzamt",
      date: p.faellig,
      dueDate: p.faellig,
      gross: p.betrag,
      open: p.offen,
      // Eine Erstattung ist nicht überfällig: Wann sie kommt, entscheidet das Finanzamt
      daysOverdue: p.offen > 0 ? daysBetween(p.faellig, today) : -1,
    }));
}

/**
 * Offene Forderungen (festgeschriebene Rechnungen und Korrekturen, nicht storniert, dazu zu erstattende Beträge aus
 * Stornos bezahlter Rechnungen) und offene Verbindlichkeiten (gebuchte, über die Bank zu zahlende Belege), nach
 * Fälligkeit sortiert. Offen ist, was die Rechnungsliste als offen zeigt (listInvoices, @haben/core lebenszyklus.ts).
 *
 * Mit `bis` gilt der Abschlussstand zum Stichtag (#1110): `today` ist dann derselbe Tag, und es zählt nur, was bis
 * einschließlich dahin wirkt — spätere Zahlungen fehlen, Belege und Rechnungen, die es damals noch nicht gab, auch.
 */
export async function openPositions(today: string, { bis }: { bis?: string } = {}) {
  // Auch die Anzahlungen und ihre Forderungen rechnen zum Stichtag, wenn einer gesetzt ist (#1110)
  const { invoiceIds, receivables: newReceivables, ...advances } = await advanceOpenPositions(bis ?? today);
  const separate = new Set(invoiceIds);
  const receivables: OpenPosition[] = [...(await openReceivables(today, bis, separate)), ...newReceivables];
  const payables = await openPayables(today, bis);
  const vat = await openVatPosten(today, bis);

  const byDue = (a: OpenPosition, b: OpenPosition) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number);
  receivables.sort(byDue);
  payables.sort(byDue);
  const total = (items: OpenPosition[]) => items.reduce((s, i) => s + i.open, 0);
  const overdue = (items: OpenPosition[]) => items.filter((i) => i.daysOverdue > 0);
  return {
    ...advances,
    receivables,
    payables,
    receivablesTotal: total(receivables) + advances.unbilledReceivablesTotal,
    payablesTotal: total(payables),
    receivablesOverdue: total(overdue([...receivables, ...advances.unbilledReceivables])),
    payablesOverdue: total(overdue(payables)),
    vat,
    vatTotal: total(vat),
    vatOverdue: total(overdue(vat)),
  };
}

/**
 * Jahre mit Bankumsätzen, Rechnungen, Belegen oder Buchungen, für die Jahresauswahl. Die EÜR rechnet aus dem Journal
 * (#1116); ein Jahr, das nur über den Datenimport gebucht ist, gehört deshalb ebenso in die Auswahl.
 */
export async function reportYears(): Promise<number[]> {
  const rows = await db.execute<{ year: number }>(sql`
    select distinct extract(year from d)::int as year from (
      select booking_date as d from bank_transactions where bank_account_id not in (select id from bank_accounts where excluded_at is not null)
      union all select issue_date from invoices where status = 'final'
      union all select document_date from documents where status = 'gebucht' and document_date is not null
      union all select date from journal_entries
    ) dates order by 1`);
  return [...rows].map((r) => Number(r.year));
}
