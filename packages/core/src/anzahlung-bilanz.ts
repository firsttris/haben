import type { AdvanceVatEvent } from "./anzahlung-steuer.ts";
import { totalsFromTaxes } from "./invoice.ts";
import { ACCOUNTS, invoicePosting, invoiceWriteOffPosting, revenueTaxCode, side, type Kontenrahmen, type PostingLine, type TaxShare } from "./posting.ts";
import type { TaxTreatment } from "./treatment.ts";
import type { Cents } from "./money.ts";

/**
 * Neue Bilanz-Schlussketten unterstützen Zahlungen vor Leistung noch nicht (#853). Eine Anforderung ist dafür
 * der vorgesehene Weg; Altbelege behalten ihre Zahlungswege. § 13 Abs. 1 Nr. 1 a Satz 4 UStG und Entscheidung:
 * https://github.com/firsttris/haben/issues/750#issuecomment-6850907108
 */
export function advancePaymentDateProblem(
  invoice: {
    kind: "rechnung" | "storno" | "korrektur";
    variant: "abschlag" | "schluss" | null;
    advanceAccounting: "deferred" | null;
    issueDate: string;
    serviceFrom: string | null;
    serviceTo: string | null;
  },
  date: string,
  amount: Cents,
): string | null {
  if (
    amount > 0 &&
    invoice.kind === "rechnung" &&
    invoice.advanceAccounting === "deferred" &&
    invoice.variant === "schluss" &&
    date < (invoice.serviceTo ?? invoice.serviceFrom ?? invoice.issueDate)
  ) {
    return "Eine Zahlung vor dem Leistungsdatum lässt sich dieser Schlussrechnung nicht zuordnen. Bitte verwende dafür eine Abschlagsrechnung.";
  }
  return null;
}

export interface AdvanceBalanceEvent extends AdvanceVatEvent {
  /** Bei writtenOff erforderlich: Das normale Ausbuchungskonto wird bis zur Leistung neutralisiert. */
  kind?: "skonto" | "forderungsausfall";
}

export interface AdvanceBalanceChange {
  date: string;
  lines: PostingLine[];
}

/**
 * EU-/Drittlandumsätze werden unabhängig vom Zufluss gemeldet. Die Nettoabgrenzung bleibt steuerneutral;
 * diese reine Meldebasis verwendet die vorhandenen Schlüssel und gespeicherten Anteile ohne zweite Geldbewegung.
 * EU-Leistungen: Leistungsmonat; IGL: Rechnungsmonat (§ 18b UStG), https://www.gesetze-im-internet.de/ustg_1980/__18b.html
 */
export function advanceReportingPosting(shares: readonly TaxShare[], frame: Kontenrahmen, treatment: TaxTreatment): PostingLine[] {
  if (treatment !== "reverse_charge" && treatment !== "ig_lieferung" && treatment !== "drittland") return [];
  return shares
    .filter((share) => share.base !== 0)
    .map((share) => ({
      account: ACCOUNTS[frame].forderungen,
      debit: 0,
      credit: 0,
      taxCode: revenueTaxCode(share.rate, treatment),
      basis: share.base,
    }));
}

/** Datierte Differenz zweier eigener Abgrenzungspläne, ohne Rücklesen des Journals. */
export function advanceBalanceDifference(before: readonly AdvanceBalanceChange[], after: readonly AdvanceBalanceChange[]): AdvanceBalanceChange[] {
  const days = new Map<string, Map<string, number>>();
  for (const [changes, sign] of [
    [before, -1],
    [after, 1],
  ] as const) {
    for (const { date, lines } of changes) {
      let accounts = days.get(date);
      if (!accounts) {
        accounts = new Map();
        days.set(date, accounts);
      }
      for (const line of lines) accounts.set(line.account, (accounts.get(line.account) ?? 0) + sign * (line.debit - line.credit));
    }
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, accounts]) => ({
      date,
      lines: [...accounts]
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([, amount]) => amount !== 0)
        .map(([account, amount]) => side(account, amount, true, null)),
    }))
    .filter((change) => change.lines.length);
}

/**
 * § 252 Abs. 1 Nr. 4 HGB: vor Leistung tatsächliche Nettozuflüsse als erhaltene Anzahlungen, danach der volle Erlös.
 * https://www.gesetze-im-internet.de/hgb/__252.html
 * Die normale Zahlung bucht nur Bank/Kasse gegen Forderung; Ausbuchungen verwenden Umsatzsteuer nicht fällig.
 * invoicePosting und invoiceWriteOffPosting liefern dieselben gespeicherten Centanteile wie die normalen Buchungen.
 * Die Fälligkeit und Meldung der Steuer bleibt allein bei #745; hier deshalb keine Steuerschlüssel oder Meldebasis.
 * Eine erbrachte Leistung bleibt auch beim Storno der Schlussrechnung erbracht; der Schlussrest gehört nicht hierher.
 */
export function advanceBalancePlan(
  total: readonly TaxShare[],
  events: readonly AdvanceBalanceEvent[],
  kontenrahmen: Kontenrahmen,
  treatment: TaxTreatment = "regulaer",
): AdvanceBalanceChange[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const revenueAccounts = new Set<string>([...Object.values(accounts.erloese), ...Object.values(accounts.erloeseSonder)]);
  const byDate = new Map<string, AdvanceBalanceEvent[]>();
  for (const event of events) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
  const paid: TaxShare[] = [];
  const amount = [...total];
  const writtenOff: { kind: "skonto" | "forderungsausfall"; shares: TaxShare[] }[] = [];
  let performed = false;
  let previous: PostingLine[] = [];
  const changes: AdvanceBalanceChange[] = [];
  for (const [date, day] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    for (const event of day) {
      paid.push(...(event.paid ?? []));
      amount.push(...(event.correction ?? []));
      performed ||= event.performance === 1;
      if (event.writtenOff?.length) {
        if (event.kind !== "skonto" && event.kind !== "forderungsausfall")
          throw new RangeError("Ausbuchung der Anzahlung benötigt Skonto oder Forderungsausfall.");
        writtenOff.push({ kind: event.kind, shares: event.writtenOff });
      }
    }
    const target = invoicePosting(totalsFromTaxes(performed ? amount : paid), kontenrahmen, "ist", treatment).map((line) =>
      side(!performed && revenueAccounts.has(line.account) ? accounts.erhalteneAnzahlungen : line.account, line.debit - line.credit, true, null),
    );
    if (!performed) {
      for (const { kind, shares } of writtenOff) {
        const totals = totalsFromTaxes(shares);
        target.push(
          ...invoiceWriteOffPosting(kind, totals, totals.gross, kontenrahmen, "ist", treatment, shares).map((line) =>
            side(line.account, line.debit - line.credit, false, null),
          ),
        );
      }
    }
    changes.push(...advanceBalanceDifference([{ date, lines: previous }], [{ date, lines: target }]));
    previous = target;
  }
  return changes;
}
