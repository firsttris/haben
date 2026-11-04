import type { Cents } from "./money.ts";
import { compactIban, isValidBic, isValidIban, SEPA_ID_PATTERN, sepaText } from "./sepa-text.ts";

/**
 * SEPA-Überweisung als pain.001.001.09 nach Anlage 3 des DFÜ-Abkommens der Deutschen Kreditwirtschaft, Version 3.9
 * (gültig ab 5. Oktober 2025, Schema pain.001.001.09_GBIC_5.xsd). Die Datei lädt man im Online-Banking hoch.
 *
 * Längen und Pflichtfelder aus dem Schema der DK: Namen höchstens 70 Zeichen (Max140Text_SCT_SCTinst),
 * Verwendungszweck 140 (Ustrd), Kennungen 35, Beträge 0,01 bis 999.999.999,99 Euro; der Auftraggeber braucht
 * DbtrAgt, ohne BIC als NOTPROVIDED.
 */

export const PAIN_001_NAMESPACE = "urn:iso:std:iso:20022:tech:xsd:pain.001.001.09";

const NAME_LENGTH = 70;
const REMITTANCE_LENGTH = 140;
const MAX_AMOUNT: Cents = 99_999_999_999;

export interface SepaAccount {
  name: string;
  iban: string;
  /** Optional: innerhalb des EWR reicht die IBAN */
  bic?: string;
}

export interface SepaTransaction {
  /** Kennung, die die Bank bis zum Empfänger weiterreicht und die im Kontoauszug wieder auftaucht */
  endToEndId: string;
  amount: Cents;
  creditor: SepaAccount;
  /** Unstrukturierter Verwendungszweck */
  remittance: string;
}

export interface SepaTransferOrder {
  messageId: string;
  paymentInfoId: string;
  /** Erstellungszeitpunkt, ISO ohne Bruchteile: 2026-11-04T10:15:00 */
  createdAt: string;
  /** Gewünschtes Ausführungsdatum (JJJJ-MM-TT) */
  executionDate: string;
  debtor: SepaAccount;
  transactions: SepaTransaction[];
}

export type Pain001Result = { ok: true; xml: string; numberOfTransactions: number; controlSum: Cents } | { ok: false; problems: string[] };

/** 12345 → "123.45" */
export function sepaAmount(cents: Cents): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function accountProblems(account: SepaAccount, role: string): string[] {
  const problems: string[] = [];
  if (sepaText(account.name, NAME_LENGTH) === "") problems.push(`${role}: Name fehlt`);
  if (account.iban.trim() === "") problems.push(`${role}: IBAN fehlt`);
  else if (!isValidIban(account.iban)) problems.push(`${role}: IBAN ${account.iban} ist ungültig`);
  if (account.bic && !isValidBic(account.bic)) problems.push(`${role}: BIC ${account.bic} ist ungültig`);
  return problems;
}

/** Was an einem Auftrag nicht passt, als Sätze für die Oberfläche; leer, wenn die Datei entstehen kann */
export function sepaTransferProblems(order: SepaTransferOrder): string[] {
  const problems: string[] = [];
  if (order.transactions.length === 0) problems.push("Keine Überweisung ausgewählt");
  for (const [label, id] of [
    ["MsgId", order.messageId],
    ["PmtInfId", order.paymentInfoId],
  ] as const) {
    if (!SEPA_ID_PATTERN.test(id)) problems.push(`${label} ${id} passt nicht zum Schema`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(order.executionDate)) problems.push("Ausführungsdatum fehlt");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(order.createdAt)) problems.push("Erstellungszeitpunkt fehlt");
  problems.push(...accountProblems(order.debtor, "Auftraggeberkonto"));
  const seen = new Set<string>();
  for (const tx of order.transactions) {
    const who = sepaText(tx.creditor.name, NAME_LENGTH) || "Empfänger";
    if (!SEPA_ID_PATTERN.test(tx.endToEndId)) problems.push(`${who}: Referenz ${tx.endToEndId} passt nicht zum Schema`);
    if (seen.has(tx.endToEndId)) problems.push(`${who}: Referenz ${tx.endToEndId} kommt doppelt vor`);
    seen.add(tx.endToEndId);
    if (!Number.isInteger(tx.amount) || tx.amount < 1 || tx.amount > MAX_AMOUNT) problems.push(`${who}: Betrag muss zwischen 0,01 und 999.999.999,99 € liegen`);
    problems.push(...accountProblems(tx.creditor, who));
  }
  return problems;
}

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Ein Element mit Text; der Text ist schon auf den Zeichensatz gebracht, & < > können nicht mehr vorkommen */
const el = (name: string, content: string, attributes = "") => `<${name}${attributes}>${escapeXml(content)}</${name}>`;

const agent = (bic: string) => `<FinInstnId>${el("BICFI", bic)}</FinInstnId>`;

function transactionXml(tx: SepaTransaction): string {
  const bic = tx.creditor.bic?.replace(/\s+/g, "").toUpperCase();
  const remittance = sepaText(tx.remittance, REMITTANCE_LENGTH);
  return [
    "<CdtTrfTxInf>",
    `<PmtId>${el("EndToEndId", tx.endToEndId)}</PmtId>`,
    `<Amt>${el("InstdAmt", sepaAmount(tx.amount), ' Ccy="EUR"')}</Amt>`,
    bic ? `<CdtrAgt>${agent(bic)}</CdtrAgt>` : "",
    `<Cdtr>${el("Nm", sepaText(tx.creditor.name, NAME_LENGTH))}</Cdtr>`,
    `<CdtrAcct><Id>${el("IBAN", compactIban(tx.creditor.iban))}</Id></CdtrAcct>`,
    remittance ? `<RmtInf>${el("Ustrd", remittance)}</RmtInf>` : "",
    "</CdtTrfTxInf>",
  ].join("");
}

/**
 * pain.001.001.09 mit einem Zahlungsauftrag (PmtInf) und einer Transaktion je Empfänger. BtchBookg=false: Die Bank bucht
 * jede Überweisung einzeln ab, damit der Bankabgleich jede Abbuchung ihrem Beleg zuordnen kann. NbOfTxs und CtrlSum
 * stehen in Kopf und Auftrag und werden aus den Transaktionen gezählt.
 */
export function pain001(order: SepaTransferOrder): Pain001Result {
  const problems = sepaTransferProblems(order);
  if (problems.length > 0) return { ok: false, problems };
  const numberOfTransactions = order.transactions.length;
  const controlSum = order.transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const count = String(numberOfTransactions);
  const sum = sepaAmount(controlSum);
  const debtorName = sepaText(order.debtor.name, NAME_LENGTH);
  const debtorBic = order.debtor.bic?.replace(/\s+/g, "").toUpperCase();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Document xmlns="${PAIN_001_NAMESPACE}">`,
    "<CstmrCdtTrfInitn>",
    "<GrpHdr>",
    el("MsgId", order.messageId),
    el("CreDtTm", order.createdAt),
    el("NbOfTxs", count),
    el("CtrlSum", sum),
    `<InitgPty>${el("Nm", debtorName)}</InitgPty>`,
    "</GrpHdr>",
    "<PmtInf>",
    el("PmtInfId", order.paymentInfoId),
    el("PmtMtd", "TRF"),
    el("BtchBookg", "false"),
    el("NbOfTxs", count),
    el("CtrlSum", sum),
    "<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>",
    `<ReqdExctnDt>${el("Dt", order.executionDate)}</ReqdExctnDt>`,
    `<Dbtr>${el("Nm", debtorName)}</Dbtr>`,
    `<DbtrAcct><Id>${el("IBAN", compactIban(order.debtor.iban))}</Id></DbtrAcct>`,
    // Ohne BIC verlangt das Schema der DK die Angabe NOTPROVIDED
    `<DbtrAgt>${debtorBic ? agent(debtorBic) : "<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>"}</DbtrAgt>`,
    el("ChrgBr", "SLEV"),
    ...order.transactions.map(transactionXml),
    "</PmtInf>",
    "</CstmrCdtTrfInitn>",
    "</Document>",
    "",
  ].join("\n");
  return { ok: true, xml, numberOfTransactions, controlSum };
}
