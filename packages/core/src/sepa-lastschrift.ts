import { addDays, easterSunday } from "./holidays.ts";
import type { Cents } from "./money.ts";
import { sepaAmount } from "./sepa.ts";
import { glaeubigerIdProblem, mandatsreferenzProblem, normalizeGlaeubigerId, type MandatSchema } from "./sepa-mandat.ts";
import { compactIban, isEwrIban, isValidBic, isValidIban, SEPA_ID_PATTERN, sepaText } from "./sepa-text.ts";

/**
 * SEPA-Lastschrift als pain.008.001.08 nach Anlage 3 des DFÜ-Abkommens der Deutschen Kreditwirtschaft, Version 3.9
 * (ab 5. Oktober 2025; Version 26.11 ab 15. November 2026 behält das Format), Schema pain.008.001.08_GBIC_5.xsd. Die
 * Datei lädt man im Online-Banking hoch (#445).
 *
 * Aufbau nach dem Schema der DK: je Verfahren (CORE, B2B), Sequenz (FRST, RCUR) und Fälligkeit ein Sammler (PmtInf) mit
 * Gläubiger-ID (CdtrSchmeId, Prtry SEPA) und darin je Rechnung eine Lastschrift mit Mandatsreferenz und Datum der
 * Unterschrift. BtchBookg=true: Die Bank schreibt den Sammler als eine Summe gut; der Bankabgleich teilt sie auf die
 * Rechnungen auf. Namen höchstens 70 Zeichen (Anlage 3), Verwendungszweck 140 (Ustrd), Kennungen 35. Ohne BIC steht
 * NOTPROVIDED. Lastschriften nur von Konten im EWR: außerhalb verlangt die DK die Anschrift des Zahlungspflichtigen.
 */

export const PAIN_008_NAMESPACE = "urn:iso:std:iso:20022:tech:xsd:pain.008.001.08";

const NAME_LENGTH = 70;
const REMITTANCE_LENGTH = 140;
const MAX_AMOUNT: Cents = 99_999_999_999;

export type SepaSequence = "FRST" | "RCUR";

export interface SepaDirectDebitTransaction {
  endToEndId: string;
  amount: Cents;
  mandate: { reference: string; signedOn: string };
  debtor: { name: string; iban: string; bic?: string };
  remittance: string;
}

/** Ein Sammler: gleiche Fälligkeit, gleiches Verfahren, gleiche Sequenz */
export interface SepaDirectDebitBatch {
  paymentInfoId: string;
  scheme: MandatSchema;
  sequence: SepaSequence;
  /** Fälligkeit (ReqdColltnDt, JJJJ-MM-TT) */
  collectionDate: string;
  transactions: SepaDirectDebitTransaction[];
}

export interface SepaDirectDebitOrder {
  messageId: string;
  /** Erstellungszeitpunkt, ISO ohne Bruchteile */
  createdAt: string;
  creditor: { name: string; iban: string; bic?: string };
  creditorId: string;
  batches: SepaDirectDebitBatch[];
}

export type Pain008Result = { ok: true; xml: string; numberOfTransactions: number; controlSum: Cents } | { ok: false; problems: string[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function accountProblems(account: { name: string; iban: string; bic?: string }, role: string): string[] {
  const problems: string[] = [];
  if (sepaText(account.name, NAME_LENGTH) === "") problems.push(`${role}: Name fehlt`);
  if (account.iban.trim() === "") problems.push(`${role}: IBAN fehlt`);
  else if (!isValidIban(account.iban)) problems.push(`${role}: IBAN ${account.iban} ist ungültig`);
  if (account.bic && !isValidBic(account.bic)) problems.push(`${role}: BIC ${account.bic} ist ungültig`);
  return problems;
}

function transactionProblems(tx: SepaDirectDebitTransaction, seen: Set<string>): string[] {
  const who = sepaText(tx.debtor.name, NAME_LENGTH) || "Zahlungspflichtiger";
  const problems: string[] = [];
  if (!SEPA_ID_PATTERN.test(tx.endToEndId)) problems.push(`${who}: Referenz ${tx.endToEndId} passt nicht zum Schema`);
  if (seen.has(tx.endToEndId)) problems.push(`${who}: Referenz ${tx.endToEndId} kommt doppelt vor`);
  seen.add(tx.endToEndId);
  if (!Number.isInteger(tx.amount) || tx.amount < 1 || tx.amount > MAX_AMOUNT) problems.push(`${who}: Betrag muss zwischen 0,01 und 999.999.999,99 € liegen`);
  const reference = mandatsreferenzProblem(tx.mandate.reference);
  if (reference) problems.push(`${who}: ${reference}`);
  if (!DATE.test(tx.mandate.signedOn)) problems.push(`${who}: Datum der Unterschrift fehlt`);
  problems.push(...accountProblems(tx.debtor, who));
  if (isValidIban(tx.debtor.iban) && !isEwrIban(tx.debtor.iban)) problems.push(`${who}: Lastschriften zieht Haben nur von Konten im EWR ein`);
  return problems;
}

/** Was an einem Auftrag nicht passt, als Sätze für die Oberfläche; leer, wenn die Datei entstehen kann */
export function sepaDirectDebitProblems(order: SepaDirectDebitOrder): string[] {
  if (order.batches.every((b) => b.transactions.length === 0)) return ["Keine Lastschrift ausgewählt"];
  const problems: string[] = [];
  if (!SEPA_ID_PATTERN.test(order.messageId)) problems.push(`MsgId ${order.messageId} passt nicht zum Schema`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(order.createdAt)) problems.push("Erstellungszeitpunkt fehlt");
  const creditorId = glaeubigerIdProblem(order.creditorId);
  if (creditorId) problems.push(`Gläubiger-ID: ${creditorId}`);
  problems.push(...accountProblems(order.creditor, "Gläubigerkonto"));
  const seen = new Set<string>();
  for (const batch of order.batches) {
    if (!SEPA_ID_PATTERN.test(batch.paymentInfoId)) problems.push(`PmtInfId ${batch.paymentInfoId} passt nicht zum Schema`);
    if (!DATE.test(batch.collectionDate)) problems.push("Fälligkeit fehlt");
    for (const tx of batch.transactions) problems.push(...transactionProblems(tx, seen));
  }
  return problems;
}

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Ein Element mit Text; der Text ist schon auf den Zeichensatz gebracht */
const el = (name: string, content: string, attributes = "") => `<${name}${attributes}>${escapeXml(content)}</${name}>`;

/** Kreditinstitut: BIC, sonst NOTPROVIDED (Anlage 3, IBAN-only) */
const agent = (bic: string | undefined) => {
  const code = bic?.replace(/\s+/g, "").toUpperCase();
  return `<FinInstnId>${code ? el("BICFI", code) : "<Othr><Id>NOTPROVIDED</Id></Othr>"}</FinInstnId>`;
};

const sumOf = (transactions: SepaDirectDebitTransaction[]) => transactions.reduce((sum, tx) => sum + tx.amount, 0);

function transactionXml(tx: SepaDirectDebitTransaction): string {
  const remittance = sepaText(tx.remittance, REMITTANCE_LENGTH);
  return [
    "<DrctDbtTxInf>",
    `<PmtId>${el("EndToEndId", tx.endToEndId)}</PmtId>`,
    el("InstdAmt", sepaAmount(tx.amount), ' Ccy="EUR"'),
    `<DrctDbtTx><MndtRltdInf>${el("MndtId", tx.mandate.reference)}${el("DtOfSgntr", tx.mandate.signedOn)}</MndtRltdInf></DrctDbtTx>`,
    `<DbtrAgt>${agent(tx.debtor.bic)}</DbtrAgt>`,
    `<Dbtr>${el("Nm", sepaText(tx.debtor.name, NAME_LENGTH))}</Dbtr>`,
    `<DbtrAcct><Id>${el("IBAN", compactIban(tx.debtor.iban))}</Id></DbtrAcct>`,
    remittance ? `<RmtInf>${el("Ustrd", remittance)}</RmtInf>` : "",
    "</DrctDbtTxInf>",
  ].join("");
}

function batchXml(order: SepaDirectDebitOrder, batch: SepaDirectDebitBatch): string {
  return [
    "<PmtInf>",
    el("PmtInfId", batch.paymentInfoId),
    el("PmtMtd", "DD"),
    el("BtchBookg", "true"),
    el("NbOfTxs", String(batch.transactions.length)),
    el("CtrlSum", sepaAmount(sumOf(batch.transactions))),
    `<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm>${el("Cd", batch.scheme)}</LclInstrm>${el("SeqTp", batch.sequence)}</PmtTpInf>`,
    el("ReqdColltnDt", batch.collectionDate),
    `<Cdtr>${el("Nm", sepaText(order.creditor.name, NAME_LENGTH))}</Cdtr>`,
    `<CdtrAcct><Id>${el("IBAN", compactIban(order.creditor.iban))}</Id></CdtrAcct>`,
    `<CdtrAgt>${agent(order.creditor.bic)}</CdtrAgt>`,
    el("ChrgBr", "SLEV"),
    `<CdtrSchmeId><Id><PrvtId><Othr>${el("Id", normalizeGlaeubigerId(order.creditorId))}<SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>`,
    ...batch.transactions.map(transactionXml),
    "</PmtInf>",
  ].join("");
}

/** pain.008.001.08 mit einem Sammler je Fälligkeit, Verfahren und Sequenz; NbOfTxs und CtrlSum aus den Lastschriften */
export function pain008(order: SepaDirectDebitOrder): Pain008Result {
  const problems = sepaDirectDebitProblems(order);
  if (problems.length > 0) return { ok: false, problems };
  const batches = order.batches.filter((b) => b.transactions.length > 0);
  const all = batches.flatMap((b) => b.transactions);
  const controlSum = sumOf(all);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    `<Document xmlns="${PAIN_008_NAMESPACE}"><CstmrDrctDbtInitn>`,
    "<GrpHdr>",
    el("MsgId", order.messageId),
    el("CreDtTm", order.createdAt),
    el("NbOfTxs", String(all.length)),
    el("CtrlSum", sepaAmount(controlSum)),
    `<InitgPty>${el("Nm", sepaText(order.creditor.name, NAME_LENGTH))}</InitgPty>`,
    "</GrpHdr>",
    ...batches.map((b) => batchXml(order, b)),
    "</CstmrDrctDbtInitn></Document>\n",
  ].join("");
  return { ok: true, xml, numberOfTransactions: all.length, controlSum };
}

/**
 * TARGET-Geschäftstag: Montag bis Freitag außer 1. Januar, Karfreitag, Ostermontag, 1. Mai, 25. und 26. Dezember
 * (Allgemeine Geschäftsbedingungen der Deutschen Bundesbank; Feiertagsliste „TARGET-Feiertage“ 2026). Nach diesem
 * Kalender zählen die Inter-PSP Business Days der Lastschrift (SDD Core Rulebook v1.2, Kap. 4.3).
 */
export function isTargetDay(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const mmdd = day.slice(5);
  if (["01-01", "05-01", "12-25", "12-26"].includes(mmdd)) return false;
  const easter = easterSunday(Number(day.slice(0, 4)));
  return day !== addDays(easter, -2) && day !== addDays(easter, 1);
}

function nextTargetDay(day: string): string {
  let next = addDays(day, 1);
  while (!isTargetDay(next)) next = addDays(next, 1);
  return next;
}

/**
 * Fälligkeit (ReqdColltnDt) einer Lastschrift: die Fälligkeit der Rechnung, frühestens der zweite TARGET-Tag nach heute
 * und immer ein TARGET-Tag. Die Bank des Gläubigers muss die Lastschrift spätestens einen TARGET-Tag vor Fälligkeit
 * (D-1) an die Bank des Zahlers geben (SDD Core Rulebook v1.2, Kap. 4.3.4); mit dem Hochladen heute bleibt ihr dafür
 * ein Tag. Eigene Annahmeschlusszeiten der Bank können mehr verlangen.
 */
export function collectionDateFor(dueDate: string, today: string): string {
  const earliest = nextTargetDay(nextTargetDay(today));
  let day = dueDate > earliest ? dueDate : earliest;
  while (!isTargetDay(day)) day = addDays(day, 1);
  return day;
}
