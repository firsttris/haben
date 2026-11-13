import { ACCOUNTS, formatEuro, type Kontenrahmen } from "@haben/core";
import { sql } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db/index.ts";
import { advanceReceivablesAt } from "../rechnungen/index.ts";
import type { Abgleich, AbgleichZeile } from "./abgleich.ts";

/**
 * Bestände desselben markierten Belegumfangs, kein globaler Sammelkontenabgleich: Altbelege, Eröffnungen und freie
 * Sachbuchungen haben hier keine Nebenbuch-Gegenposition. Herkunft nur aus IDs, nie aus Buchungstexten erschließen.
 * Unbilanzierte Anforderungen und fortbestehender Anspruch beim Papierstorno: Entscheidung in #750.
 * https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
 */
export async function oposAbgleich(cutoff: string, q: Db | Tx = db): Promise<Abgleich> {
  const stand = await advanceReceivablesAt(cutoff, q);
  if (!stand.invoiceIds.length) return { zeilen: [], hinweise: [] };
  const rows = await q.execute<{ kontenrahmen: Kontenrahmen; account: string; saldo: string }>(sql`
    with sources(kind,id) as (
      select 'invoice',id from invoices where id in ${stand.invoiceIds}
      union all select 'allocation',id from allocations where invoice_id in ${stand.invoiceIds}
      union all select 'kasse',id from cash_entries where invoice_id in ${stand.invoiceIds}
      union all select 'ausbuchung',id from write_offs where invoice_id in ${stand.invoiceIds}
    )
    select e.kontenrahmen,l.account,sum(l.debit-l.credit) as saldo
      from journal_entries e join journal_lines l on l.entry_id=e.id
      join sources s on s.kind=e.source_type and s.id=e.source_id
     where e.date <= ${cutoff}
     group by e.kontenrahmen,l.account`);
  let receivables = 0;
  let advances = 0;
  for (const row of rows) {
    const accounts = ACCOUNTS[row.kontenrahmen];
    if (row.account === accounts.forderungen) receivables += Number(row.saldo);
    if (row.account === accounts.erhalteneAnzahlungen) advances -= Number(row.saldo);
  }
  const row = (posten: string, journal: number, quelle: number): AbgleichZeile => ({ bereich: "opos", zeitraum: cutoff, posten, journal, quelle });
  const hinweise: string[] = [];
  if (stand.requests !== 0) hinweise.push(`${cutoff}: Unbilanzierte Anzahlungsanforderungen ${formatEuro(stand.requests)}; nicht im Forderungssaldo.`);
  if (stand.unbilled !== 0)
    hinweise.push(`${cutoff}: Realisierter Schlussrest ohne aktuellen Schlussbeleg ${formatEuro(stand.unbilled)}; im Forderungssaldo enthalten.`);
  return {
    zeilen: [
      row("Bilanzierte Forderungen aus neuen Anzahlungs-/Schlussketten", receivables, stand.receivables),
      row("Erhaltene Anzahlungen netto, neues Verfahren", advances, stand.netAdvances),
    ],
    hinweise,
  };
}

/** Historische Monatsenden und im laufenden Monat nur der heutige Tag; auch bei null Journal ohne Schreibzugriff. */
export async function oposAbgleichJahr(year: number, today: string, q: Db | Tx): Promise<Abgleich> {
  const currentYear = Number(today.slice(0, 4));
  const lastMonth = year < currentYear ? 12 : year === currentYear ? Number(today.slice(5, 7)) : 0;
  const result: Abgleich = { zeilen: [], hinweise: [] };
  for (let month = 1; month <= lastMonth; month++) {
    const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const stand = await oposAbgleich(monthEnd < today ? monthEnd : today, q);
    result.zeilen.push(...stand.zeilen);
    result.hinweise.push(...stand.hinweise);
  }
  return result;
}

/** Auch eine Anforderung ohne Buchung und ihr unveränderter Übertrag ins laufende Jahr müssen sichtbar bleiben. */
export async function oposYears(today: string, q: Db | Tx): Promise<number[]> {
  const [row] = await q.execute<{ year: number | null }>(sql`
    with marked as (select id,issue_date,service_to,service_from from invoices where status='final' and advance_accounting='deferred'),
    dates(d) as (
      select issue_date from marked
      union all select coalesce(service_to,service_from,issue_date) from marked
      union all select b.booking_date from marked i join allocations a on a.invoice_id=i.id join bank_transactions b on b.id=a.transaction_id
      union all select c.date from marked i join cash_entries c on c.invoice_id=i.id
      union all select w.date from marked i join write_offs w on w.invoice_id=i.id
    ) select extract(year from min(d))::int as year from dates where d <= ${today}`);
  if (row?.year == null) return [];
  const firstYear = Number(row.year);
  return Array.from({ length: Number(today.slice(0, 4)) - firstYear + 1 }, (_, index) => firstYear + index);
}
