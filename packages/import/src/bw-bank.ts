import { isValidIban } from "@haben/core";
import { accountIbanOf, finish, indexed, optional, optionalReference, pendingWarning, requireAmount, type Tx } from "./common.ts";
import { isBlankRow } from "./csv.ts";
import { Columns } from "./table.ts";
import { normalizeIban, normalizeText, parseDate, parseGermanAmount, requireDate } from "./text.ts";
import type { ParsedStatement } from "./types.ts";

/*
 * Umsätze aus dem Online-Banking der BW-Bank (Baden-Württembergische Bank, https://www.bw-bank.de/): Semikolon-CSV in Windows-1252,
 * ohne Kopfblock und ohne Kontostand, Anführungszeichen um jedes Feld, Datum TT.MM.JJ. Die erste Spalte „Auftragskonto“
 * ist die eigene IBAN. Die Exporte „Excel (CSV-CAMT V2)“, „(CSV-CAMT V8)“, „(CSV-MT940)“ und „(CSV - gefilterte Einträge)“
 * haben zwei Aufbauten:
 *
 *  - CSV-CAMT V2, V8 und gefilterte Einträge: Auftragskonto, Buchungstag, Valutadatum, Buchungstext, Verwendungszweck,
 *    Glaeubiger ID, Mandatsreferenz, Kundenreferenz (End-to-End), Sammlerreferenz, Lastschrift Ursprungsbetrag,
 *    Auslagenersatz Ruecklastschrift, Beguenstigter/Zahlungspflichtiger, Kontonummer/IBAN, BIC (SWIFT-Code), Betrag,
 *    Waehrung, Info; die gefilterten Einträge hängen „Kategorie“ an. Referenzen stehen in eigenen Spalten.
 *  - CSV-MT940: nur Auftragskonto bis Verwendungszweck, Beguenstigter/Zahlungspflichtiger, Kontonummer (enthält die
 *    IBAN), BLZ (enthält die BIC), Betrag, Waehrung, Info. Bei SEPA-Lastschriften steht alles im Zweck:
 *    „EREF+…MREF+…CRED+…SVWZ+…“, ohne Trenner.
 *
 * „Info“ nennt den Status: „Umsatz gebucht“, sonst vorgemerkt.
 *
 * Wahrscheinlich ist das der CSV-Export der Sparkassen: Die BW-Bank gehört über die LBBW zur Sparkassen-Finanzgruppe, und
 * die Köpfe gleichen den Sparkassen-Vorlagen in https://github.com/nicolettas-muggelbude/RechnungsFee. Mit einer echten
 * Sparkassen-Datei ist das nicht geprüft; das Format heißt deshalb `bw-bank-csv`. Weicht eine Sparkasse ab, lässt sich
 * die Bank an der BLZ in „Auftragskonto“ unterscheiden (BW-Bank: 600 501 01).
 */
export function isBwBankHeader(c: Columns): boolean {
  return c.has("auftragskonto") && c.has("buchungstag") && c.has("valutadatum") && c.has("beguenstigterzahlungspflichtiger") && c.has("betrag");
}

const TAGS = /(EREF|KREF|MREF|CRED|SVWZ|ABWA|ABWE|IBAN|BIC)\+/;

/** Felder „EREF+…“ aus dem Verwendungszweck der älteren Fassung; ohne Felder oder ohne „SVWZ+“ bleibt der Text, wie er ist */
function splitPurpose(text: string): { purpose: string; fields: Map<string, string> } {
  const parts = text.split(TAGS);
  if (parts.length < 3 || parts[0] !== "") return { purpose: normalizeText(text), fields: new Map() };
  const fields = new Map<string, string>();
  for (let i = 1; i + 1 < parts.length; i += 2) if (!fields.has(parts[i]!)) fields.set(parts[i]!, parts[i + 1]!.trim());
  return { purpose: normalizeText(fields.get("SVWZ") ?? text), fields };
}

function counterpartyIban(value: string, own: string | undefined): string | undefined {
  const iban = normalizeIban(value);
  return iban && iban !== own && isValidIban(iban) ? iban : undefined;
}

export function parseBwBank(rows: string[][], headerRow: number): ParsedStatement {
  const c = new Columns(rows[headerRow]!);
  const ownIban = c.getter("auftragskonto");
  const bookingDate = c.getter("buchungstag");
  const valueDate = c.getter("valutadatum");
  const kind = c.getter("buchungstext");
  const purpose = c.getter("verwendungszweck");
  const creditorId = c.getter("glaeubigerid");
  const mandate = c.getter("mandatsreferenz");
  const endToEnd = c.getter("kundenreferenz");
  const collective = c.getter("sammlerreferenz");
  const name = c.getter("beguenstigterzahlungspflichtiger");
  const iban = c.getter("kontonummeriban", "kontonummer");
  const amount = c.getter("betrag");
  const currency = c.getter("waehrung");
  const info = c.getter("info");

  const data = rows.slice(headerRow + 1).map((row, i) => ({ row, where: `Zeile ${headerRow + i + 2}` }));
  const filled = data.filter(({ row }) => !isBlankRow(row));
  const booked = filled.filter(({ row }) => !/vorgemerkt/i.test(info(row)));
  const accountIban = accountIbanOf(booked.map(({ row }) => normalizeIban(ownIban(row))));

  const list: Tx[] = booked.map(({ row, where }) => {
    const cents = requireAmount(parseGermanAmount(amount(row)), amount(row), where);
    const text = splitPurpose(purpose(row));
    return {
      bookingDate: requireDate(bookingDate(row), where),
      valueDate: parseDate(valueDate(row)) ?? undefined,
      amount: cents,
      currency: currency(row) || "EUR",
      counterpartyName: normalizeText(name(row)),
      counterpartyIban: counterpartyIban(iban(row), accountIban),
      purpose: text.purpose,
      type: optional(normalizeText(kind(row))),
      endToEndId: optionalReference(endToEnd(row) || text.fields.get("EREF") || text.fields.get("KREF")),
      bankReference: optionalReference(collective(row)),
      mandateReference: optional(mandate(row) || text.fields.get("MREF") || ""),
      creditorId: optional(creditorId(row) || text.fields.get("CRED") || ""),
    };
  });

  return finish({
    format: "bw-bank-csv",
    accountIban,
    currency: "EUR",
    transactions: indexed(list),
    warnings: pendingWarning(filled.length - booked.length),
  });
}
