import type { Cents } from "@haben/core";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { finish, indexed, optional, optionalReference, pendingWarning, requireAmount, type Tx } from "./common.ts";
import { StatementParseError } from "./errors.ts";
import { normalizeIban, normalizeText, parseDate, parseDotAmount, requireDate } from "./text.ts";
import type { ParsedStatement } from "./types.ts";

// Knoten nach dem Einlesen ohne Namensraum-Präfixe; Attribute mit "@_"
type Node = Record<string, unknown>;

function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Alle Knoten am Ende des Pfads, auch wenn er mehrfach vorkommt. */
function all(node: unknown, ...path: string[]): unknown[] {
  const last = path.pop();
  const parent = child(node, ...path);
  if (last === undefined || parent === null || typeof parent !== "object") return [];
  return list((parent as Node)[last]);
}

function child(node: unknown, ...path: string[]): unknown {
  let current = node;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    const next = (current as Node)[key];
    current = Array.isArray(next) ? next[0] : next;
  }
  return current;
}

function text(node: unknown, ...path: string[]): string | undefined {
  const value = child(node, ...path);
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value !== null && typeof value === "object" && "#text" in value) {
    return String((value as Node)["#text"]).trim();
  }
  return undefined;
}

function attr(node: unknown, name: string, ...path: string[]): string | undefined {
  const value = child(node, ...path);
  if (value === null || typeof value !== "object") return undefined;
  const a = (value as Node)[`@_${name}`];
  return typeof a === "string" ? a : undefined;
}

/** <Amt Ccy="EUR">12.34</Amt> mit <CdtDbtInd>DBIT</CdtDbtInd> → -1234 */
function signedAmount(amountNode: unknown, indicator: string | undefined, where: string): Cents {
  const raw = text(amountNode) ?? "";
  const cents = requireAmount(parseDotAmount(raw), raw, where);
  return indicator === "DBIT" ? -cents : cents;
}

function dateOf(node: unknown): string | undefined {
  return text(node, "Dt") ?? text(node, "DtTm");
}

function partyName(party: unknown): string | undefined {
  return text(party, "Nm") ?? text(party, "Pty", "Nm");
}

function status(entry: unknown): string {
  return (text(entry, "Sts") ?? text(entry, "Sts", "Cd") ?? text(entry, "Sts", "Prtry") ?? "BOOK").toUpperCase();
}

const families: Record<string, string> = {
  RCDT: "Gutschrift",
  ICDT: "Überweisung",
  IDDT: "Lastschrift",
  RDDT: "Lastschrifteinzug",
  CCRD: "Kartenzahlung",
  MCRD: "Kartenzahlung",
  CHRG: "Entgelt",
  INTR: "Zinsen",
};

function transactionType(node: unknown): string | undefined {
  const proprietary = text(node, "BkTxCd", "Prtry", "Cd");
  const family = text(node, "BkTxCd", "Domn", "Fmly", "Cd");
  return (family ? families[family] : undefined) ?? proprietary;
}

function familyCode(node: unknown): string | undefined {
  const domain = text(node, "BkTxCd", "Domn", "Cd");
  const family = text(node, "BkTxCd", "Domn", "Fmly", "Cd");
  const sub = text(node, "BkTxCd", "Domn", "Fmly", "SubFmlyCd");
  return domain && family ? [domain, family, sub].filter(Boolean).join("/") : undefined;
}

function purposeOf(details: unknown): string {
  const unstructured = all(details, "RmtInf", "Ustrd")
    .map((u) => text(u) ?? "")
    .join(" ");
  if (normalizeText(unstructured) !== "") return normalizeText(unstructured);
  const structured = all(details, "RmtInf", "Strd")
    .map((s) => text(s, "CdtrRefInf", "Ref") ?? text(s, "AddtlRmtInf") ?? "")
    .join(" ");
  return normalizeText(structured);
}

function parseXml(xml: string): Node {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new StatementParseError(`Die XML-Datei ist fehlerhaft (Zeile ${valid.err.line}): ${valid.err.msg}`);
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  });
  return parser.parse(xml) as Node;
}

export function isCamt053(xml: string): boolean {
  return /<(\w+:)?BkToCstmrStmt[\s>]/.test(xml);
}

/** ISO 20022 camt.053 (Versionen .001.02 bis .001.08). Nur ein Konto pro Datei. */
export function parseCamt053(xml: string): ParsedStatement {
  const doc = parseXml(xml);
  const root = child(doc, "Document", "BkToCstmrStmt") ?? child(doc, "BkToCstmrStmt");
  const statements = all(root, "Stmt");
  if (statements.length === 0) throw new StatementParseError("Die CAMT-Datei enthält keinen Kontoauszug (Stmt).");

  const result: ParsedStatement = { format: "camt053", currency: "EUR", transactions: [], warnings: [] };
  const txs: Tx[] = [];
  let pending = 0;
  let currency: string | undefined;
  const fromDates: string[] = [];
  const toDates: string[] = [];

  statements.forEach((stmt, s) => {
    const iban = normalizeIban(text(stmt, "Acct", "Id", "IBAN"));
    if (s === 0) {
      result.accountIban = iban;
      result.accountName = optional(normalizeText(text(stmt, "Acct", "Nm")));
    } else if (iban !== result.accountIban) {
      throw new StatementParseError(
        "Die CAMT-Datei enthält Auszüge mehrerer Konten. Bitte je Konto eine Datei hochladen.",
      );
    }
    currency ??= text(stmt, "Acct", "Ccy");

    const from = parseDate(text(stmt, "FrToDt", "FrDtTm") ?? "");
    const to = parseDate(text(stmt, "FrToDt", "ToDtTm") ?? "");
    if (from) fromDates.push(from);
    if (to) toDates.push(to);

    for (const bal of all(stmt, "Bal")) {
      const code = text(bal, "Tp", "CdOrPrtry", "Cd");
      const amount = signedAmount(child(bal, "Amt"), text(bal, "CdtDbtInd"), `Saldo ${code ?? ""}`);
      currency ??= attr(bal, "Ccy", "Amt");
      // Bei mehreren Auszügen zählt der erste Anfangs- und der letzte Endsaldo
      if ((code === "OPBD" || code === "PRCD") && result.openingBalance === undefined) {
        result.openingBalance = amount;
      }
      if (code === "CLBD") result.closingBalance = amount;
    }

    all(stmt, "Ntry").forEach((entry, e) => {
      const where = `Auszug ${s + 1}, Umsatz ${e + 1}`;
      const st = status(entry);
      if (st === "PDNG") {
        pending++;
        return;
      }
      if (st !== "BOOK" && st !== "BOOKED") {
        result.warnings.push(`Umsatz mit Status ${st} übersprungen (${where}).`);
        return;
      }
      const indicator = text(entry, "CdtDbtInd");
      const entryAmount = signedAmount(child(entry, "Amt"), indicator, where);
      const entryCurrency = attr(entry, "Ccy", "Amt") ?? currency ?? "EUR";
      const bookingDate = requireDate(dateOf(child(entry, "BookgDt")), where);
      const valueDate = parseDate(dateOf(child(entry, "ValDt")) ?? "") ?? undefined;
      const entryRef = optionalReference(text(entry, "AcctSvcrRef"));
      const additional = normalizeText(text(entry, "AddtlNtryInf"));
      // Mehrere NtryDtls-Blöcke sind selten, aber erlaubt
      const details = all(entry, "NtryDtls").flatMap((n) => all(n, "TxDtls"));

      const ownAmount = (d: unknown): unknown => child(d, "Amt") ?? child(d, "AmtDtls", "TxAmt", "Amt");
      const batch = details.length > 1 && details.every((d) => ownAmount(d) !== undefined);

      const build = (d: unknown, amount: Cents, purposeFallback: string, inBatch: boolean): Tx => {
        const endToEnd = optionalReference(text(d, "Refs", "EndToEndId"));
        const credit = amount >= 0;
        const party = child(d, "RltdPties", credit ? "Dbtr" : "Cdtr");
        const ultimate = child(d, "RltdPties", credit ? "UltmtDbtr" : "UltmtCdtr");
        const account = child(d, "RltdPties", credit ? "DbtrAcct" : "CdtrAcct");
        const purpose = purposeOf(d);
        return {
          bookingDate,
          valueDate,
          amount,
          currency: attr(d, "Ccy", "Amt") ?? entryCurrency,
          counterpartyName: normalizeText(partyName(party) ?? partyName(ultimate)),
          counterpartyIban: normalizeIban(text(account, "Id", "IBAN")),
          purpose: purpose !== "" ? purpose : purposeFallback,
          type: transactionType(d) ?? transactionType(entry) ?? optional(additional) ?? familyCode(entry),
          // In Sammelbuchungen teilen sich alle Posten die Referenz des Eintrags
          bankReference:
            optionalReference(text(d, "Refs", "AcctSvcrRef")) ??
            (inBatch ? (endToEnd ?? entryRef) : (entryRef ?? endToEnd)),
          mandateReference: optional(normalizeText(text(d, "Refs", "MndtId"))),
          creditorId: optional(normalizeText(text(d, "RltdPties", "Cdtr", "Id", "PrvtId", "Othr", "Id"))),
        };
      };

      if (batch) {
        let sum = 0;
        for (const d of details) {
          const amount = signedAmount(ownAmount(d), text(d, "CdtDbtInd") ?? indicator, where);
          sum += amount;
          txs.push(build(d, amount, additional, true));
        }
        if (sum !== entryAmount) {
          result.warnings.push(`Sammelbuchung: Einzelbeträge ergeben nicht den Gesamtbetrag (${where}).`);
        }
      } else {
        const tx = build(details[0], entryAmount, additional, false);
        if (details.length > 1) {
          const purposes = details.map(purposeOf).filter((p) => p !== "");
          if (purposes.length > 0) tx.purpose = purposes.join(" ");
        }
        txs.push(tx);
      }
    });
  });

  result.currency = currency ?? txs[0]?.currency ?? "EUR";
  result.transactions = indexed(txs);
  result.warnings.push(...pendingWarning(pending));
  if (fromDates.length > 0) result.periodFrom = fromDates.sort()[0];
  if (toDates.length > 0) result.periodTo = toDates.sort()[toDates.length - 1];
  return finish(result);
}
