import type { Cents } from "./money.ts";
import type { InvoiceTotals } from "./invoice.ts";
import { ACCOUNTS, type Kontenrahmen, type Versteuerung } from "./kontenplan.ts";
import { revenueTaxCode, side, vatRate, type PostingLine } from "./posting.ts";

/* Buchungen für Rechnungen und Belege aus der Vorgänger-Buchhaltung. Teil von posting.ts. */

/**
 * Eröffnungsbuchung für eine offene Rechnung aus der Vorgänger-Buchhaltung: Forderung an Saldenvortrag.
 * Die Erlöse stehen schon in den alten Büchern. Bei Ist-Versteuerung ist die Umsatzsteuer dort noch
 * nicht angemeldet; sie kommt auf „Umsatzsteuer nicht fällig“ und wird mit dem Zahlungseingang fällig.
 */
export function openingInvoicePosting(totals: InvoiceTotals, kontenrahmen: Kontenrahmen, versteuerung: Versteuerung): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.forderungen, totals.gross, true, null)];
  if (versteuerung === "ist") {
    for (const { rate, tax } of totals.taxes) {
      if (tax !== 0) lines.push(side(accounts.ustNichtFaellig[vatRate(rate)], tax, false, null));
    }
    lines.push(side(accounts.saldenvortrag, totals.net, false, null));
  } else {
    lines.push(side(accounts.saldenvortrag, totals.gross, false, null));
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

/** Eröffnungsbuchung für einen offenen Eingangsbeleg: Saldenvortrag an Verbindlichkeiten. Vorsteuer ist schon angemeldet. */
export function openingDocumentPosting(gross: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  return [side(accounts.saldenvortrag, gross, true, null), side(accounts.verbindlichkeiten, gross, false, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}

/**
 * Storno oder Korrektur einer aus der Vorgänger-Buchhaltung übernommenen Rechnung (negative Summen).
 * Die Erlöse stehen in den alten Büchern, deshalb geht der Nettobetrag wie bei der Eröffnung gegen den
 * Saldenvortrag. Bei Soll mindert die Korrektur die dort schon angemeldete Umsatzsteuer, bei Ist die
 * noch nicht fällige.
 */
export function legacyCorrectionPosting(totals: InvoiceTotals, kontenrahmen: Kontenrahmen, versteuerung: Versteuerung): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.forderungen, totals.gross, true, null)];
  for (const { rate, tax } of totals.taxes) {
    if (tax === 0) continue;
    if (versteuerung === "ist") lines.push(side(accounts.ustNichtFaellig[vatRate(rate)], tax, false, null));
    else lines.push(side(accounts.ust[vatRate(rate)], tax, false, revenueTaxCode(rate)));
  }
  if (versteuerung === "ist") {
    lines.push(side(accounts.saldenvortrag, totals.net, false, null));
  } else {
    // Soll: Die Voranmeldung meldet die Korrektur im Monat der Korrektur mit ihrer Bemessungsgrundlage (§ 17 UStG); je
    // Steuersatz eine Zeile mit Steuerschlüssel, damit das Journal sie trägt (#542). Bei Ist zählt die Erstattung.
    for (const { rate, base } of totals.taxes) lines.push(side(accounts.saldenvortrag, base, false, revenueTaxCode(rate)));
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}
