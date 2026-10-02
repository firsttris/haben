import { isCamt053, parseCamt053 } from "./camt.ts";
import { parseCsv } from "./csv.ts";
import { decodeText } from "./decode.ts";
import { isDkbAltHeader, isDkbHeader, parseDkb, parseDkbAlt } from "./dkb.ts";
import { StatementParseError } from "./errors.ts";
import { isN26Header, parseN26 } from "./n26.ts";
import { findHeaderRow } from "./table.ts";
import type { ParsedStatement, StatementFormat } from "./types.ts";

type Detected =
  | { format: "camt053"; text: string }
  | { format: Exclude<StatementFormat, "camt053">; rows: string[][]; headerRow: number };

function detect(text: string, label: string): Detected {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) {
    if (isCamt053(trimmed)) return { format: "camt053", text: trimmed };
    if (/BkToCstmrAcctRpt|BkToCstmrDbtCdtNtfctn/.test(trimmed)) {
      throw new StatementParseError(
        `${label} ist ein CAMT.052- oder CAMT.054-Bericht. Unterstützt wird nur der Tagesauszug CAMT.053.`,
      );
    }
    throw new StatementParseError(`${label} ist eine XML-Datei, aber kein CAMT.053-Kontoauszug.`);
  }

  const semicolon = parseCsv(text, ";");
  const dkb = findHeaderRow(semicolon, isDkbHeader);
  if (dkb >= 0) return { format: "dkb-csv", rows: semicolon, headerRow: dkb };
  const dkbAlt = findHeaderRow(semicolon, isDkbAltHeader);
  if (dkbAlt >= 0) return { format: "dkb-csv-alt", rows: semicolon, headerRow: dkbAlt };

  const comma = parseCsv(text, ",");
  const n26 = findHeaderRow(comma, isN26Header);
  if (n26 >= 0) return { format: "n26-csv", rows: comma, headerRow: n26 };

  throw new StatementParseError(
    `${label} wurde nicht erkannt. Unterstützt werden CSV-Exporte von DKB und N26 sowie CAMT.053 (XML).`,
  );
}

/**
 * Liest einen Kontoauszug. Bank und Format werden am Inhalt erkannt, nicht am Dateinamen;
 * der Dateiname dient nur der Fehlermeldung.
 */
export function parseStatement(bytes: Uint8Array, filename?: string): ParsedStatement {
  const label = filename ? `„${filename}“` : "Die Datei";
  const text = decodeText(bytes).replace(/^﻿/, "");
  if (text.trim() === "") throw new StatementParseError(`${label} ist leer.`);
  if (text.includes("\u0000")) throw new StatementParseError(`${label} ist keine Text- oder XML-Datei.`);

  const detected = detect(text, label);
  switch (detected.format) {
    case "camt053":
      return parseCamt053(detected.text);
    case "dkb-csv":
      return parseDkb(detected.rows, detected.headerRow);
    case "dkb-csv-alt":
      return parseDkbAlt(detected.rows, detected.headerRow);
    case "n26-csv":
      return parseN26(detected.rows, detected.headerRow);
  }
}

/** Nur das Format bestimmen, ohne die Umsätze zu lesen. */
export function detectStatementFormat(bytes: Uint8Array): StatementFormat | null {
  try {
    return detect(decodeText(bytes).replace(/^﻿/, ""), "Die Datei").format;
  } catch {
    return null;
  }
}
