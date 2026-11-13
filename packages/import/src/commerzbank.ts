import { isValidIban } from "@haben/core";
import { finish, indexed, optional, optionalReference, requireAmount, type Tx } from "./common.ts";
import { isBlankRow } from "./csv.ts";
import { StatementParseError } from "./errors.ts";
import { Columns } from "./table.ts";
import { normalizeIban, normalizeText, parseDate, parseGermanAmount, requireDate } from "./text.ts";
import type { ParsedStatement } from "./types.ts";

/*
 * Commerzbank exportiert die Umsätze im Online-Banking als Semikolon-CSV (UTF-8 mit BOM), ohne Kopfblock und ohne
 * Kontostand: Buchungstag, Wertstellung, Umsatzart, Buchungstext, Betrag, Währung, IBAN Kontoinhaber, Kategorie,
 * Sender, Empfänger, Verwendungszweck. Beträge deutsch, mit keiner, einer oder zwei Nachkommastellen.
 *
 * Die Gegen-IBAN steht nur im Buchungstext, bei Ausgängen, Daueraufträgen und eigenen Lastschriften, nicht bei Eingängen.
 * Hinter Name, Zweck und IBAN folgen die Felder „End-to-End-Ref.:“, „Kundenreferenz:“, „Mandatsref:“ und
 * „Gläubiger-ID:“. Ein Wert reicht bis zum nächsten Feld und kann Leerzeichen enthalten; hinter der Referenz eines
 * Dauerauftrags steht noch das Wort „Dauerauftrag“, hinter der Gläubiger-ID die Art der Lastschrift.
 */
export function isCommerzbankHeader(c: Columns): boolean {
  return c.has("buchungstag") && c.has("umsatzart") && c.has("buchungstext") && c.has("ibankontoinhaber");
}

const FIELD = /(End-to-End-Ref\.:|Kundenreferenz:|Mandatsref:|Gläubiger-ID:)/;

interface BookingText {
  /** Name, Zweck und IBAN vor dem ersten Feld */
  head: string;
  fields: Map<string, string>;
}

function splitBookingText(text: string): BookingText {
  const [head = "", ...rest] = text.split(FIELD);
  const fields = new Map<string, string>();
  for (let i = 0; i + 1 < rest.length; i += 2) fields.set(rest[i]!, normalizeText(rest[i + 1]));
  return { head: normalizeText(head), fields };
}

/** Referenz ohne die angehängte Umsatzart („NOTPROVIDED Dauerauftrag“) und ohne Platzhalter der Bank */
function reference(value: string | undefined, type: string): string | undefined {
  const suffix = ` ${type}`.toLowerCase();
  const trimmed = value && type && value.toLowerCase().endsWith(suffix) ? value.slice(0, -suffix.length) : value;
  return optionalReference(trimmed);
}

/**
 * Erste gültige IBAN im Text vor den Feldern, außer der eigenen; eine Gläubiger-ID scheitert an der Prüfziffer. Eine
 * strukturierte Referenz nach ISO 11649 („RF…“ im Zweck) hat dieselbe Prüfziffer wie eine IBAN, RF ist aber kein Land.
 */
function counterpartyIban(head: string, own: string | undefined): string | undefined {
  for (const token of head.split(" ")) {
    const iban = normalizeIban(token.replace(/[^A-Za-z0-9]/g, ""));
    if (iban && iban !== own && !iban.startsWith("RF") && isValidIban(iban)) return iban;
  }
  return undefined;
}

/** Zweck aus der eigenen Spalte; ohne ihn (Entgelte) der Buchungstext vor den Feldern ohne den Namen */
function purposeOf(purpose: string, head: string, name: string): string {
  if (purpose) return purpose;
  return name && head.startsWith(name) ? head.slice(name.length).trim() : head;
}

function accountIbanOf(ibans: (string | undefined)[]): string | undefined {
  const distinct = new Set(ibans.filter((iban): iban is string => iban !== undefined));
  if (distinct.size > 1) throw new StatementParseError("Die CSV-Datei enthält Umsätze mehrerer Konten. Bitte je Konto eine Datei hochladen.");
  return [...distinct][0];
}

export function parseCommerzbank(rows: string[][], headerRow: number): ParsedStatement {
  const c = new Columns(rows[headerRow]!);
  const bookingDate = c.getter("buchungstag");
  const valueDate = c.getter("wertstellung");
  const kind = c.getter("umsatzart");
  const bookingText = c.getter("buchungstext");
  const amount = c.getter("betrag");
  const currency = c.getter("währung");
  const ownIban = c.getter("ibankontoinhaber");
  const sender = c.getter("sender");
  const recipient = c.getter("empfänger");
  const purpose = c.getter("verwendungszweck");

  const data = rows.slice(headerRow + 1).map((row, i) => ({ row, where: `Zeile ${headerRow + i + 2}` }));
  const filled = data.filter(({ row }) => !isBlankRow(row));
  const accountIban = accountIbanOf(filled.map(({ row }) => normalizeIban(ownIban(row))));

  const list: Tx[] = filled.map(({ row, where }) => {
    const cents = requireAmount(parseGermanAmount(amount(row)), amount(row), where);
    const type = normalizeText(kind(row));
    const name = normalizeText(cents > 0 ? sender(row) || recipient(row) : recipient(row) || sender(row));
    const text = splitBookingText(bookingText(row));
    return {
      bookingDate: requireDate(bookingDate(row), where),
      valueDate: parseDate(valueDate(row)) ?? undefined,
      amount: cents,
      currency: currency(row) || "EUR",
      counterpartyName: name,
      counterpartyIban: counterpartyIban(text.head, accountIban),
      purpose: purposeOf(normalizeText(purpose(row)), text.head, name),
      type: optional(type),
      endToEndId: reference(text.fields.get("End-to-End-Ref.:"), type),
      bankReference: reference(text.fields.get("Kundenreferenz:"), type),
      mandateReference: optional(text.fields.get("Mandatsref:") ?? ""),
      creditorId: optional(text.fields.get("Gläubiger-ID:")?.split(" ")[0] ?? ""),
    };
  });

  return finish({
    format: "commerzbank-csv",
    accountIban,
    currency: "EUR",
    transactions: indexed(list),
    warnings: [],
  });
}
