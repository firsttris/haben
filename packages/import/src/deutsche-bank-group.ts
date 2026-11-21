import { type Cents, isValidIban } from "@haben/core";
import { finish, indexed, optional, optionalReference, requireAmount, type Tx } from "./common.ts";
import { isBlankRow } from "./csv.ts";
import { StatementParseError } from "./errors.ts";
import { Columns } from "./table.ts";
import { normalizeHeader, normalizeIban, normalizeText, parseDate, parseGermanAmount, requireDate } from "./text.ts";
import type { ParsedStatement } from "./types.ts";

/*
 * Deutsche Bank, Norisbank und Postbank nutzen dasselbe Online-Banking und exportieren die Umsätze gleich: Semikolon-CSV
 * (UTF-8 mit BOM), ein Kopfblock, dann die Tabelle, am Ende eine Zeile „Kontostand“. Der Kopfblock nennt die eigene IBAN
 * (Zeile „Konto;Filial-/Kontonummer;IBAN;Währung“ mit den Werten darunter), den Zeitraum und den letzten Kontostand; die
 * Tabelle trägt Buchungstag, Wert, Umsatzart, Begünstigter / Auftraggeber, Verwendungszweck, IBAN / Kontonummer, BIC,
 * Kundenreferenz, Mandatsreferenz, Gläubiger ID, Fremde Gebühren, Betrag, Abweichender Empfänger, Anzahl der Aufträge,
 * Anzahl der Schecks, Soll, Haben und Währung. Beträge deutsch, mit keiner, einer oder zwei Nachkommastellen, Daten ohne
 * führende Nullen.
 *
 * Formatquellen: die Firefly-III-Konfiguration für die Deutsche Bank
 * (https://github.com/firefly-iii/import-configurations/tree/main/de/deutschebank) und der Banana-Testfall
 * csv_deutschebank_example_format5_20250414.csv (Postbank-Export); eine offizielle Beschreibung des Spaltenlayouts gibt
 * die Bank nicht heraus.
 *
 * „Betrag“ ist gefüllt und trägt das Vorzeichen; Soll und Haben wiederholen ihn. Fehlt er, zählt die gefüllte Spalte von
 * Soll und Haben. „Abweichender Empfänger“ bleibt unberücksichtigt: dort steht bei einer Umbuchung auf ein eigenes Konto
 * der eigene Name. Die Fußzeile ist der Kontostand am Ende, kein Umsatz.
 *
 * Bis Anfang 2024 exportierte die Gruppe eine ältere Fassung (Windows-1252, 19 Spalten): „IBAN“ statt „IBAN / Kontonummer“,
 * dazu „Abweichender Auftraggeber“, und der Betrag steht nur in Soll oder Haben. Ihr Kopfblock nennt keine eigene IBAN;
 * dort wählt man das Konto beim Import wie bei N26. Beide Fassungen erkennt Haben an den Spaltennamen. Formatquelle der
 * älteren Fassung: der Banana-Testfall csv_deutschebank_example_format3_20240131.csv (19 Spalten, „Betrag“ leer, Soll
 * negativ, Kopfblock ohne IBAN). Dessen Kopf- und Fußzeilen hat Banana unkenntlich gemacht; im Klartext steht derselbe
 * Aufbau im Kommentar zu Format 2 (Export von 2014) in ch.banana.germany.import.deutschebank.js: „Kundennummer“ statt
 * IBAN im Kopfblock, „Letzter Kontostand“ und die Fußzeile „Kontostand“. Beides wie format5 unter
 * https://github.com/BananaAccounting/Germany/tree/master/importApps/deutschebank_import_bank_statement_csv
 */
export function isDeutscheBankGroupHeader(c: Columns): boolean {
  return c.has("buchungstag") && c.has("wert") && c.has("umsatzart") && c.has("begünstigter") && c.has("ibankontonummer");
}

/** Export bis Anfang 2024: „IBAN“ statt „IBAN / Kontonummer“, dazu „Abweichender Auftraggeber“. */
export function isDeutscheBankGroupAltHeader(c: Columns): boolean {
  return c.has("buchungstag") && c.has("umsatzart") && c.has("begünstigter") && c.has("abweichenderauftraggeber") && !c.has("ibankontonummer");
}

interface Header {
  accountIban?: string;
  accountName?: string;
  periodFrom?: string;
  periodTo?: string;
  /** Kontostand aus dem Kopfblock, vor dem ersten Umsatz der Datei */
  opening?: Cents;
}

/** Zeitraum des Exports, etwa „1.1.2026 - 19.11.2026“ */
const PERIOD = /^(\d{1,2}\.\d{1,2}\.\d{2,4})\s*-\s*(\d{1,2}\.\d{1,2}\.\d{2,4})$/;

/** Erster Betrag in der Zeile; links davon stehen nur Datum, Bezeichnung und Leerzellen. */
function amountIn(cells: string[]): Cents | null {
  for (const cell of cells.slice(1)) {
    const amount = parseGermanAmount(cell.trim());
    if (amount !== null) return amount;
  }
  return null;
}

/** Kopfblock vor der Tabelle: eigene IBAN mit Kontoname, Zeitraum und letzter Kontostand. */
function readHeader(rows: string[][]): Header {
  const header: Header = {};
  rows.forEach((cells, i) => {
    const keys = cells.map(normalizeHeader);
    if (header.accountIban === undefined && keys.includes("iban")) {
      const values = rows[i + 1] ?? [];
      const iban = normalizeIban(values[keys.indexOf("iban")]);
      if (iban) {
        header.accountIban = iban;
        header.accountName = optional(normalizeText(values[keys.indexOf("konto")]));
      }
    }
    const first = normalizeText(cells[0]);
    const period = PERIOD.exec(first);
    if (period) {
      header.periodFrom = parseDate(period[1]!) ?? undefined;
      header.periodTo = parseDate(period[2]!) ?? undefined;
    } else if (/^letzter kontostand$/i.test(first)) {
      header.opening = amountIn(cells) ?? header.opening;
    }
  });
  return header;
}

/** Betrag der Zeile: „Betrag“ trägt das Vorzeichen; fehlt er, zählt die gefüllte Spalte von Soll und Haben. */
function amountOf(
  row: string[],
  get: { amount: (r: string[]) => string; soll: (r: string[]) => string; haben: (r: string[]) => string },
  where: string,
): Cents {
  const signed = get.amount(row);
  if (signed !== "") return requireAmount(parseGermanAmount(signed), signed, where);
  const one = get.soll(row) || get.haben(row);
  if (one === "") throw new StatementParseError(`Der Betrag fehlt (${where}).`);
  return requireAmount(parseGermanAmount(one), one, where);
}

/** Gegen-IBAN nur mit gültiger Prüfziffer und nie die eigene (Umbuchung auf ein eigenes Konto). */
function counterpartyIbanOf(value: string, own: string | undefined): string | undefined {
  const iban = normalizeIban(value);
  return iban && iban !== own && isValidIban(iban) ? iban : undefined;
}

/**
 * Salden nur übernehmen, wenn der letzte Kontostand aus dem Kopf plus die Umsätze den Kontostand am Ende ergibt;
 * sonst nennt Haben den Grund und lässt die Salden weg.
 */
function applyBalances(statement: ParsedStatement, opening: Cents | undefined, closing: { date?: string; amount: Cents } | undefined): void {
  if (closing === undefined) return;
  const sum = statement.transactions.reduce((acc, t) => acc + t.amount, 0);
  if (opening === undefined) {
    statement.warnings.push("Der Kopfblock nennt keinen letzten Kontostand; die Salden lassen sich nicht prüfen und werden nicht übernommen.");
    return;
  }
  if (opening + sum !== closing.amount) {
    statement.warnings.push("Letzter Kontostand und Kontostand am Ende gehen nicht mit den Umsätzen auf; Salden werden nicht übernommen.");
    return;
  }
  statement.openingBalance = opening;
  statement.closingBalance = closing.amount;
  if (closing.date) statement.statedBalance = { date: closing.date, amount: closing.amount };
}

export function parseDeutscheBankGroup(rows: string[][], headerRow: number): ParsedStatement {
  const header = readHeader(rows.slice(0, headerRow));
  const c = new Columns(rows[headerRow]!);
  const get = {
    bookingDate: c.getter("buchungstag"),
    valueDate: c.getter("wert"),
    kind: c.getter("umsatzart"),
    party: c.getter("begünstigter"),
    purpose: c.getter("verwendungszweck"),
    iban: c.getter("ibankontonummer", "iban"),
    reference: c.getter("kundenreferenz"),
    mandate: c.getter("mandatsreferenz"),
    creditorId: c.getter("gläubigerid"),
    amount: c.getter("betrag"),
    soll: c.getter("soll"),
    haben: c.getter("haben"),
    currency: c.getter("währung"),
  };

  const list: Tx[] = [];
  let closing: { date?: string; amount: Cents } | undefined;
  rows.slice(headerRow + 1).forEach((row, i) => {
    if (isBlankRow(row)) return;
    if (normalizeText(row[0]) === "Kontostand") {
      const amount = amountIn(row);
      if (amount !== null) closing = { date: parseDate((row[1] ?? "").trim()) ?? undefined, amount };
      return;
    }
    const where = `Zeile ${headerRow + i + 2}`;
    list.push({
      bookingDate: requireDate(get.bookingDate(row), where),
      valueDate: parseDate(get.valueDate(row)) ?? undefined,
      amount: amountOf(row, get, where),
      currency: get.currency(row) || "EUR",
      counterpartyName: normalizeText(get.party(row)),
      counterpartyIban: counterpartyIbanOf(get.iban(row), header.accountIban),
      purpose: normalizeText(get.purpose(row)),
      type: optional(normalizeText(get.kind(row))),
      bankReference: optionalReference(get.reference(row)),
      creditorId: optional(get.creditorId(row)),
      mandateReference: optional(get.mandate(row)),
    });
  });

  const statement: ParsedStatement = {
    format: "deutsche-bank-group-csv",
    accountIban: header.accountIban,
    accountName: header.accountName,
    currency: "EUR",
    periodFrom: header.periodFrom,
    periodTo: header.periodTo,
    transactions: indexed(list),
    warnings: [],
  };
  applyBalances(statement, header.opening, closing);
  return finish(statement);
}
