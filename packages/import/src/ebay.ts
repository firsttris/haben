import { finish, indexed, requireAmount, type Tx } from "./common.ts";
import { isBlankRow } from "./csv.ts";
import { StatementParseError } from "./errors.ts";
import { pspDate, skippedWarning } from "./psp.ts";
import { Columns } from "./table.ts";
import { normalizeText, parseDate, parseDotAmount, parseGermanAmount } from "./text.ts";
import type { ParsedStatement } from "./types.ts";

/*
 * Transaktionsbericht von eBay (Verkäufer-Cockpit Pro › Zahlungen › Berichte), CSV. Spalten und Bedeutung nach der
 * eBay-Hilfe 4847 „Abgleichen Ihrer eBay-Verkaufstransaktionen“ (deutsch und englisch, abgerufen 03.11.2026):
 * „Transaktionsbetrag (inkl. Kosten)“ / „Gross transaction amount“ ist die Zahlung vor Gebühren und Gutschriften,
 * „Nettobetrag“ / „Net amount“ der Betrag danach; „Auszahlung Nr.“ / „Payout ID“ verbindet die Zeilen mit ihrer
 * Auszahlung. Die Spalten lassen sich in eBay an- und abwählen; ältere Berichte heißen teils anders („Betrag abzügl.
 * Kosten“, „Bestellnummer“), die Namen kommen aus accounti (MIT, importers/ebay.py).
 *
 * Wie bei den übrigen Zahlungsdienstleistern wird eine Bestellung zu zwei Umsätzen: dem Bruttobetrag (voller Erlös)
 * und den einbehaltenen Gebühren (Netto − Brutto, so zählen auch Gebührenspalten, die Haben nicht kennt). Zeilen ohne
 * Bruttobetrag (Auszahlung, sonstige Gebühr, Versandetikett, Einbehalt, Korrektur) gehen mit dem Nettobetrag ein.
 */

const DATE = ["datumdertransaktionserstellung", "transaktionsdatum", "transactioncreationdate"];
const TYPE = ["typ", "type"];
const NET = ["nettobetrag", "betragabzüglkosten", "netamount"];
const PAYOUT_ID = ["auszahlungnr", "auszahlungsnr", "payoutid"];

export function isEbayHeader(c: Columns): boolean {
  return c.has(...DATE) && c.has(...TYPE) && c.has(...NET) && c.has(...PAYOUT_ID);
}

/** eBay schreibt „--“ in leere Felder (englischer Bericht) */
const value = (get: (row: string[]) => string) => (row: string[]) => {
  const raw = get(row);
  return raw === "--" ? "" : raw;
};

/** Monate, wie eBay sie im deutschen Bericht abkürzt („Jan.“, „März“, „Sept.“ …), nach den ersten drei Buchstaben */
const MONTHS = ["jan", "feb", "mär", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"];

/** Datum aus „23. Sept. 2026“ (deutscher Bericht von eBay) oder den Formaten der übrigen Dienstleister */
function ebayDate(raw: string, where: string): string {
  const named = /^(\d{1,2})\.\s*([a-zäöü]+)\.?\s+(\d{4})$/i.exec(raw.trim());
  const month = named ? MONTHS.indexOf(named[2]!.toLowerCase().slice(0, 3)) + 1 : 0;
  if (month === 0) return pspDate(raw, where);
  const parsed = parseDate(`${named![1]}.${month}.${named![3]}`);
  if (!parsed) throw new StatementParseError(`Ungültiges Datum „${raw}“ (${where}).`);
  return parsed;
}

const isPayout = (type: string) => /^(auszahlung|payout)$/i.test(type);

/**
 * Prüft je Auszahlung, ob ihre Zeilen zusammen die Auszahlung ergeben. Weicht die Summe ab, fehlt ein Teil (Zeilen im
 * Bericht des Vormonats) oder eine Zeile zählt doppelt; der Import bleibt, Haben weist nur darauf hin.
 */
function payoutWarnings(rows: { payoutId: string; type: string; amount: number }[]): string[] {
  const sums = new Map<string, number>();
  const withPayoutRow = new Set<string>();
  for (const r of rows) {
    if (!r.payoutId) continue;
    sums.set(r.payoutId, (sums.get(r.payoutId) ?? 0) + r.amount);
    if (isPayout(r.type)) withPayoutRow.add(r.payoutId);
  }
  return [...withPayoutRow]
    .filter((id) => sums.get(id) !== 0)
    .map(
      (id) =>
        `Auszahlung ${id}: Die Zeilen ergeben nicht den ausgezahlten Betrag. Vermutlich steht ein Teil im Bericht des Vormonats; sonst bitte den Bericht prüfen.`,
    );
}

/** Transaktionsbericht von eBay (Spalten deutsch oder englisch), nur Auszahlungen in Euro */
export function parseEbay(rows: string[][], headerRow: number): ParsedStatement {
  const c = new Columns(rows[headerRow]!);
  const german = c.has("nettobetrag", "betragabzüglkosten");
  const amount = (raw: string) => (german ? parseGermanAmount(raw) : parseDotAmount(raw));
  const date = value(c.getter(...DATE));
  const type = value(c.getter(...TYPE));
  const net = value(c.getter(...NET));
  const payoutId = value(c.getter(...PAYOUT_ID));
  const gross = value(c.getter("transaktionsbetrag", "grosstransactionamount"));
  const payoutCurrency = value(c.getter("auszahlungswährung", "payoutcurrency"));
  const transactionCurrency = value(c.getter("transaktionswährung", "transactioncurrency"));
  const order = value(c.getter("bestellnr", "bestellnummer", "ordernumber", "orderid"));
  const buyer = value(c.getter("namedeskäufers", "buyername"));
  const title = value(c.getter("angebotstitel", "itemtitle"));
  const description = value(c.getter("beschreibung", "description"));
  const referenceId = value(c.getter("referenznr", "referenznummer", "referenceid"));
  const transactionId = value(c.getter("transaktionsnr", "transactionid"));

  const list: Tx[] = [];
  const payoutRows: { payoutId: string; type: string; amount: number }[] = [];
  let foreign = 0;
  let foreignBuyer = 0;
  let details = 0;
  rows.slice(headerRow + 1).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const where = `Zeile ${headerRow + i + 2}`;
    // Multikauf: die Folgezeilen nennen nur die Artikel, der Betrag steht in der ersten Zeile der Bestellung
    if (!net(row)) {
      details++;
      return;
    }
    if (payoutCurrency(row) && payoutCurrency(row).toUpperCase() !== "EUR") {
      foreign++;
      return;
    }
    const kind = normalizeText(type(row));
    const orderNumber = normalizeText(order(row));
    const ref = normalizeText(referenceId(row) || transactionId(row));
    const bookingDate = ebayDate(date(row), where);
    const netAmount = requireAmount(amount(net(row)), net(row), where);
    payoutRows.push({ payoutId: payoutId(row), type: kind, amount: netAmount });
    // Ohne Auszahlungsnummer und -status: die stehen erst nach der Auszahlung im Bericht und änderten sonst den Hash
    const purpose = [kind, orderNumber ? `Bestellung ${orderNumber}` : "", normalizeText(title(row)), normalizeText(description(row)), ref]
      .filter(Boolean)
      .join(" · ");
    const base = { bookingDate, currency: "EUR", type: kind || undefined, bankReference: ref || undefined };
    const counterpartyName = isPayout(kind) ? "eBay" : normalizeText(buyer(row)) || "eBay";

    const buyerCurrency = transactionCurrency(row).toUpperCase();
    const grossAmount = gross(row) && !isPayout(kind) ? requireAmount(amount(gross(row)), gross(row), where) : null;
    if (grossAmount === null || (buyerCurrency && buyerCurrency !== "EUR")) {
      // Käufer in anderer Währung: der Bruttobetrag ist nicht in Euro, nur der Nettobetrag stimmt
      if (grossAmount !== null) foreignBuyer++;
      list.push({ ...base, amount: netAmount, counterpartyName, purpose });
      return;
    }
    if (grossAmount !== 0) list.push({ ...base, amount: grossAmount, counterpartyName, purpose });
    const fee = netAmount - grossAmount;
    if (fee !== 0) {
      list.push({
        ...base,
        amount: fee,
        counterpartyName: "eBay",
        purpose: `Gebühr · ${purpose}`,
        type: "Gebühr",
        bankReference: ref ? `${ref}-gebuehr` : undefined,
      });
    }
  });
  list.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
  return finish({
    format: "ebay-csv",
    currency: "EUR",
    transactions: indexed(list),
    warnings: [
      ...skippedWarning(foreign, "Auszahlung nicht in Euro"),
      ...skippedWarning(details, "ohne Nettobetrag (Artikelzeilen eines Multikaufs)"),
      ...(foreignBuyer === 0
        ? []
        : [
            `${foreignBuyer} ${foreignBuyer === 1 ? "Zeile" : "Zeilen"} in fremder Käuferwährung: nur der Nettobetrag in Euro übernommen, ohne getrennte Gebühr.`,
          ]),
      ...payoutWarnings(payoutRows),
    ],
  });
}
