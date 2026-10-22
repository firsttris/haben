import { finish, indexed, requireAmount, type Tx } from "./common.ts";
import { isBlankRow } from "./csv.ts";
import { StatementParseError } from "./errors.ts";
import { Columns } from "./table.ts";
import { normalizeText, parseDate, parseDotAmount, parseGermanAmount } from "./text.ts";
import type { ParsedStatement } from "./types.ts";

/*
 * Exporte von Zahlungsdienstleistern (PayPal, Stripe, Shopify Payments). Anders als ein Kontoauszug enthält eine Zeile
 * Bruttobetrag, einbehaltene Gebühr und Netto. Haben legt daraus zwei Umsätze an: den Bruttobetrag (Kundenzahlung,
 * Erstattung, Auszahlung) und die Gebühr. So lässt sich der Bruttobetrag der Rechnung zuordnen (voller Erlös) und die
 * Gebühr einzeln buchen oder der Sammelrechnung des Dienstleisters zuordnen. Auszahlungen auf die Bank sind negative
 * Umsätze und werden im Bankabgleich als Geldtransit mit dem Eingang auf dem Bankkonto verbunden.
 */

/** Datum aus „30.09.2026“, „2026-09-30 12:00:00“ oder „30/09/2026“ (PayPal mit englischen Spalten aus Europa) */
function pspDate(value: string, where: string): string {
  const parsed = parseDate(value);
  if (parsed) return parsed;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (slash) {
    // Ist der erste Teil größer als 12, ist es sicher Tag/Monat; sonst gilt die europäische Reihenfolge
    const [a, b] = [Number(slash[1]), Number(slash[2])];
    const [day, month] = b > 12 ? [b, a] : [a, b];
    const date = parseDate(`${day}.${month}.${slash[3]}`);
    if (date) return date;
  }
  throw new StatementParseError(`Ungültiges Datum „${value}“ (${where}).`);
}

function skippedWarning(count: number, what: string): string[] {
  return count === 0 ? [] : [`${count} ${count === 1 ? "Zeile" : "Zeilen"} übersprungen: ${what}.`];
}

// PayPal ---------------------------------------------------------------------------------------------------------

export function isPayPalHeader(c: Columns): boolean {
  return (c.has("brutto") && c.has("gebühr") && c.has("netto") && c.has("transaktionscode")) || (c.has("gross") && c.has("fee") && c.has("net") && c.has("transactionid"));
}

/** Aktivitätenexport von PayPal (Spalten deutsch oder englisch), nur abgeschlossene Zeilen in Euro */
export function parsePayPal(rows: string[][], headerRow: number): ParsedStatement {
  const c = new Columns(rows[headerRow]!);
  const german = c.has("brutto");
  const amount = (raw: string) => (german ? parseGermanAmount(raw) : parseDotAmount(raw));
  const date = c.getter("datum", "date");
  const name = c.getter("name");
  const type = c.getter("typ", "type");
  const status = c.getter("status");
  const currency = c.getter("währung", "currency");
  const gross = c.getter("brutto", "gross");
  const fee = c.getter("gebühr", "fee");
  const id = c.getter("transaktionscode", "transactionid");
  const invoice = c.getter("rechnungsnummer", "invoicenumber");
  const subject = c.getter("betreff", "subject", "artikelbezeichnung", "itemtitle");

  const list: Tx[] = [];
  let pending = 0;
  let foreign = 0;
  rows.slice(headerRow + 1).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const where = `Zeile ${headerRow + i + 2}`;
    if (!/^(abgeschlossen|completed)$/i.test(status(row))) {
      pending++;
      return;
    }
    if (currency(row).toUpperCase() !== "EUR") {
      foreign++;
      return;
    }
    const code = id(row);
    const purpose = [normalizeText(type(row)), normalizeText(invoice(row)), normalizeText(subject(row)), code].filter(Boolean).join(" · ");
    const bookingDate = pspDate(date(row), where);
    const grossAmount = requireAmount(amount(gross(row)), gross(row), where);
    const feeAmount = fee(row) ? requireAmount(amount(fee(row)), fee(row), where) : 0;
    if (grossAmount !== 0) {
      list.push({ bookingDate, amount: grossAmount, currency: "EUR", counterpartyName: normalizeText(name(row)), purpose, type: normalizeText(type(row)) || undefined, bankReference: code || undefined });
    }
    // PayPal schreibt die Gebühr mit Vorzeichen („-1,20“), bei Erstattungen kann sie positiv sein
    if (feeAmount !== 0) {
      list.push({ bookingDate, amount: feeAmount, currency: "EUR", counterpartyName: "PayPal", purpose: `Gebühr · ${code}`, type: "Gebühr", bankReference: code ? `${code}-gebuehr` : undefined });
    }
  });
  return finish({
    format: "paypal-csv",
    currency: "EUR",
    transactions: indexed(list),
    warnings: [...skippedWarning(pending, "nicht abgeschlossen (ausstehend, abgelehnt, storniert)"), ...skippedWarning(foreign, "nicht in Euro")],
  });
}

// Stripe ---------------------------------------------------------------------------------------------------------

export function isStripeHeader(c: Columns): boolean {
  return !c.has("payoutid") && (c.has("amount") || c.has("gross")) && c.has("fee") && c.has("net") && (c.has("availableon") || c.has("reportingcategory") || c.has("balancetransactionid"));
}

/** Saldenverlauf von Stripe („Balance history“, alter und neuer Export), nur Euro */
export function parseStripe(rows: string[][], headerRow: number): ParsedStatement {
  const c = new Columns(rows[headerRow]!);
  const id = c.getter("balancetransactionid", "id");
  const type = c.getter("reportingcategory", "type");
  const created = c.getter("createdutc", "created");
  const gross = c.getter("gross", "amount");
  const fee = c.getter("fee");
  const currency = c.getter("currency");
  const description = c.getter("description");
  const customer = c.getter("customeremail", "customername", "customerfacingamount");

  const list: Tx[] = [];
  let foreign = 0;
  rows.slice(headerRow + 1).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const where = `Zeile ${headerRow + i + 2}`;
    if (currency(row).toUpperCase() !== "EUR") {
      foreign++;
      return;
    }
    const code = id(row);
    const kind = normalizeText(type(row));
    const bookingDate = pspDate(created(row), where);
    const grossAmount = requireAmount(parseDotAmount(gross(row)), gross(row), where);
    const feeAmount = fee(row) ? requireAmount(parseDotAmount(fee(row)), fee(row), where) : 0;
    const payout = /^payout/i.test(kind);
    if (grossAmount !== 0) {
      list.push({
        bookingDate,
        amount: grossAmount,
        currency: "EUR",
        counterpartyName: payout ? "Stripe" : normalizeText(customer(row)) || normalizeText(description(row)),
        purpose: [kind, normalizeText(description(row)), code].filter(Boolean).join(" · "),
        type: kind || undefined,
        bankReference: code || undefined,
      });
    }
    // Stripe weist die Gebühr positiv aus und zieht sie vom Betrag ab
    if (feeAmount !== 0) {
      list.push({ bookingDate, amount: -feeAmount, currency: "EUR", counterpartyName: "Stripe", purpose: `Gebühr · ${code}`, type: "Gebühr", bankReference: code ? `${code}-gebuehr` : undefined });
    }
  });
  return finish({ format: "stripe-csv", currency: "EUR", transactions: indexed(list), warnings: skippedWarning(foreign, "nicht in Euro") });
}

// Shopify Payments -----------------------------------------------------------------------------------------------

export function isShopifyHeader(c: Columns): boolean {
  return c.has("payoutid") && c.has("payoutdate") && c.has("amount") && c.has("fee") && c.has("net");
}

/**
 * Transaktionsexport von Shopify Payments. Auszahlungen stehen dort nicht als eigene Zeile, nur als Auszahlungs-ID an den
 * Transaktionen; Haben bildet je ausgezahlter ID einen Umsatz über die Summe der Nettobeträge am Auszahlungstag.
 */
export function parseShopify(rows: string[][], headerRow: number): ParsedStatement {
  const c = new Columns(rows[headerRow]!);
  const date = c.getter("transactiondate");
  const type = c.getter("type");
  const order = c.getter("order");
  const payoutStatus = c.getter("payoutstatus");
  const payoutDate = c.getter("payoutdate");
  const payoutId = c.getter("payoutid");
  const amount = c.getter("amount");
  const fee = c.getter("fee");
  const net = c.getter("net");
  const currency = c.getter("currency");

  const list: Tx[] = [];
  const payouts = new Map<string, { date: string; net: number }>();
  let foreign = 0;
  rows.slice(headerRow + 1).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const where = `Zeile ${headerRow + i + 2}`;
    if (currency(row).toUpperCase() !== "EUR") {
      foreign++;
      return;
    }
    const kind = normalizeText(type(row));
    const orderName = normalizeText(order(row));
    const bookingDate = pspDate(date(row), where);
    const grossAmount = requireAmount(parseDotAmount(amount(row)), amount(row), where);
    const feeAmount = fee(row) ? requireAmount(parseDotAmount(fee(row)), fee(row), where) : 0;
    const netAmount = requireAmount(parseDotAmount(net(row)), net(row), where);
    const ref = [orderName, kind, bookingDate, String(grossAmount)].join("|");
    if (grossAmount !== 0) {
      list.push({
        bookingDate,
        amount: grossAmount,
        currency: "EUR",
        counterpartyName: orderName ? `Bestellung ${orderName}` : "Shopify Payments",
        purpose: [kind, orderName ? `Bestellung ${orderName}` : "", payoutId(row) ? `Auszahlung ${payoutId(row)}` : ""].filter(Boolean).join(" · "),
        type: kind || undefined,
        bankReference: ref,
      });
    }
    if (feeAmount !== 0) {
      list.push({
        bookingDate,
        amount: -feeAmount,
        currency: "EUR",
        counterpartyName: "Shopify Payments",
        purpose: `Gebühr · ${[kind, orderName ? `Bestellung ${orderName}` : ""].filter(Boolean).join(" · ")}`,
        type: "Gebühr",
        bankReference: `${ref}|gebuehr`,
      });
    }
    const id = payoutId(row);
    if (id && /^paid$|^bezahlt$|^ausgezahlt$/i.test(payoutStatus(row))) {
      const entry = payouts.get(id) ?? { date: pspDate(payoutDate(row), where), net: 0 };
      entry.net += netAmount;
      payouts.set(id, entry);
    }
  });
  for (const [id, payout] of payouts) {
    if (payout.net === 0) continue;
    list.push({ bookingDate: payout.date, amount: -payout.net, currency: "EUR", counterpartyName: "Shopify Payments", purpose: `Auszahlung ${id}`, type: "Auszahlung", bankReference: `payout-${id}` });
  }
  list.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
  return finish({ format: "shopify-payments-csv", currency: "EUR", transactions: indexed(list), warnings: skippedWarning(foreign, "nicht in Euro") });
}
