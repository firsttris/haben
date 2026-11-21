import { isValidIban } from "@haben/core";
import { accountIbanOf, finish, indexed, optional, optionalReference, pendingWarning, requireAmount, type Tx } from "./common.ts";
import { isBlankRow } from "./csv.ts";
import { StatementParseError } from "./errors.ts";
import { Columns } from "./table.ts";
import { normalizeIban, normalizeText, parseDate, parseGermanAmount, requireDate } from "./text.ts";
import type { ParsedStatement } from "./types.ts";

/*
 * Umsätze aus dem Online-Banking der BW-Bank (Baden-Württembergische Bank, https://www.bw-bank.de/): Semikolon-CSV in Windows-1252,
 * ohne Kopfblock und ohne Kontostand, Anführungszeichen um jedes Feld, Datum TT.MM.JJ. Die erste Spalte „Auftragskonto“
 * ist die eigene IBAN. Haben liest nur den Export „Excel (CSV-CAMT V8)“: Auftragskonto, Buchungstag, Valutadatum,
 * Buchungstext, Verwendungszweck, Glaeubiger ID, Mandatsreferenz, Kundenreferenz (End-to-End), Sammlerreferenz,
 * Lastschrift Ursprungsbetrag, Auslagenersatz Ruecklastschrift, Beguenstigter/Zahlungspflichtiger, Kontonummer/IBAN,
 * BIC (SWIFT-Code), Betrag, Waehrung, Info. Denselben Kopf haben auch ältere Standard-Exporte (2018 bis 2024).
 *
 * Die anderen Exporte erkennt Haben und lehnt sie ab, mit der Bitte um einen neuen Export in V8:
 *  - „(CSV-CAMT V2)“ und „(CSV - gefilterte Einträge)“ hängen „Kategorie“ an. Bei Lastschriften steht die
 *    End-to-End-Referenz dort in „Sammlerreferenz“, und die Gegenseite hat teils nur eine Kontonummer statt der IBAN.
 *  - „(CSV-MT940)“ hat „Kontonummer“ und „BLZ“ statt IBAN und BIC und die SEPA-Felder im Verwendungszweck
 *    („EREF+…SVWZ+…“), mit geänderten Zeichen und zusätzlichen Zeilen über 0,00 €. Gemischt mit V8 erkennt der
 *    Dubletten-Hash die Umsätze desselben Zeitraums nicht wieder.
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

const NUR_V8 = "Bitte im Online-Banking als Excel (CSV-CAMT V8) exportieren; der enthält alle Angaben vollständig.";

/** Haben liest nur CSV-CAMT V8; die anderen Exporte erkennt es am Kopf und verlangt einen neuen Export */
function requireCamtV8(c: Columns): void {
  if (c.has("blz") || !c.has("glaeubigerid")) throw new StatementParseError(`Das ist der Export „CSV-MT940“ der BW-Bank. ${NUR_V8}`);
  if (c.has("kategorie")) {
    throw new StatementParseError(`Das ist der Export „CSV-CAMT V2“ oder „CSV - gefilterte Einträge“ der BW-Bank. ${NUR_V8}`);
  }
}

function counterpartyIban(value: string, own: string | undefined): string | undefined {
  const iban = normalizeIban(value);
  return iban && iban !== own && isValidIban(iban) ? iban : undefined;
}

export function parseBwBank(rows: string[][], headerRow: number): ParsedStatement {
  const c = new Columns(rows[headerRow]!);
  requireCamtV8(c);
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
  const iban = c.getter("kontonummeriban");
  const amount = c.getter("betrag");
  const currency = c.getter("waehrung");
  const info = c.getter("info");

  const data = rows.slice(headerRow + 1).map((row, i) => ({ row, where: `Zeile ${headerRow + i + 2}` }));
  const filled = data.filter(({ row }) => !isBlankRow(row));
  const booked = filled.filter(({ row }) => !/vorgemerkt/i.test(info(row)));
  const accountIban = accountIbanOf(booked.map(({ row }) => normalizeIban(ownIban(row))));

  const list: Tx[] = booked.map(({ row, where }) => {
    const cents = requireAmount(parseGermanAmount(amount(row)), amount(row), where);
    return {
      bookingDate: requireDate(bookingDate(row), where),
      valueDate: parseDate(valueDate(row)) ?? undefined,
      amount: cents,
      currency: currency(row) || "EUR",
      counterpartyName: normalizeText(name(row)),
      counterpartyIban: counterpartyIban(iban(row), accountIban),
      purpose: normalizeText(purpose(row)),
      type: optional(normalizeText(kind(row))),
      endToEndId: optionalReference(endToEnd(row)),
      bankReference: optionalReference(collective(row)),
      mandateReference: optional(mandate(row)),
      creditorId: optional(creditorId(row)),
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
