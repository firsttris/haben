import { isKapitalgesellschaft, type EuerResult, LOHN_ZAHLUNGEN, documentOpen, periodKey, vatPostenLabel } from "@haben/core";
import { and, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { loadCompany } from "../stammdaten/index.ts";
import { euerAusDemJournal } from "./euer-quelle.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { documentNotCancelled } from "../../db/document-cancelled.ts";
import { listInvoices } from "../rechnungen/index.ts";
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

/** Erledigt je Beleg: Zuordnungen und Ausbuchungen (erhaltenes Skonto), wie im Bankabgleich */
async function paidSums(ids: string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await db.execute<{ id: string; paid: string }>(
    sql`select id, sum(amount) as paid from (
          select document_id as id, amount from allocations where document_id in ${ids}
          union all select document_id as id, amount from write_offs where document_id in ${ids}
          union all select document_id as id, amount from document_settlements where document_id in ${ids}
        ) settled group by 1`,
  );
  return new Map([...rows].map((r) => [r.id, Number(r.paid)]));
}

/**
 * Offene Forderungen (festgeschriebene Rechnungen und Korrekturen, nicht storniert, dazu zu erstattende Beträge aus
 * Stornos bezahlter Rechnungen) und offene Verbindlichkeiten (gebuchte, über die Bank zu zahlende Belege), nach
 * Fälligkeit sortiert. Offen ist, was die Rechnungsliste als offen zeigt (listInvoices, @haben/core lebenszyklus.ts).
 */
export async function openPositions(today: string) {
  const { invoiceIds, receivables: newReceivables, ...advances } = await advanceOpenPositions(today);
  const separate = new Set(invoiceIds);
  const receivables: OpenPosition[] = [
    ...(await listInvoices(today))
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
      })),
    ...newReceivables,
  ];

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
    // Storniert ist nichts mehr zu zahlen (#237)
    .where(and(eq(schema.documents.status, "gebucht"), eq(schema.documents.payment, "bank"), documentNotCancelled()));
  const documentPaid = await paidSums(documents.map((d) => d.id));
  const payables: OpenPosition[] = documents
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

  // Zahllast (positiv) und Erstattung (negativ) abgegebener Voranmeldungen; id ist der Zeitraum für den Link
  const vat: OpenPosition[] = (await ustvaPosten()).posten
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

/** Jahre mit Bankumsätzen, Rechnungen oder Belegen, für die Jahresauswahl */
export async function reportYears(): Promise<number[]> {
  const rows = await db.execute<{ year: number }>(sql`
    select distinct extract(year from d)::int as year from (
      select booking_date as d from bank_transactions where bank_account_id not in (select id from bank_accounts where excluded_at is not null)
      union all select issue_date from invoices where status = 'final'
      union all select document_date from documents where status = 'gebucht' and document_date is not null
    ) dates order by 1`);
  return [...rows].map((r) => Number(r.year));
}
