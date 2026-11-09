import type { Cents } from "./money.ts";

/**
 * Lastschriften im Bankabgleich (#445): die Sammelgutschrift einer pain.008-Datei auf die Rechnungen aufteilen und eine
 * Rücklastschrift ihrer Lastschrift zuordnen.
 *
 * Die Bank schreibt jeden Sammler (PmtInf mit BtchBookg=true) als eine Summe gut. Ein Auszug im CAMT-Format mit
 * Einzelangaben zerlegt der Import schon in Einzelumsätze mit EndToEndId; die findet der normale Vorschlag. Bleibt eine
 * Summe (CSV-Export, CAMT ohne Einzelangaben), passt sie zum Sammler oder zu allen Sammlern eines Einzugstags derselben
 * Datei.
 *
 * Eine Rückgabe bucht die Bank einzeln, oft mit Entgelt, als Lastschrift auf dem Konto. Sie trägt die EndToEndId der
 * ursprünglichen Lastschrift und einen Grund (Anlage 3 der DK V3.9, Kap. 7.1.7.12 ReturnInformation: Rsn/Cd und
 * AddtlInf mit RETURN, REJECT, REFUND oder RUECKLASTSCHRIFT).
 */

export type DirectDebitState = "eingereicht" | "gutgeschrieben" | "zurueck";

export interface CollectedDirectDebit {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  paymentInfoId: string;
  endToEndId: string;
  mandateReference: string;
  collectionDate: string;
  amount: Cents;
  debtorIban: string;
  /** eingereicht: noch keine Gutschrift zugeordnet; gutgeschrieben: der Rechnung zugeordnet; zurueck: zurückgegeben */
  state: DirectDebitState;
}

export interface DirectDebitTransaction {
  amount: Cents;
  bookingDate: string;
  purpose: string;
  bankReference: string | null;
  endToEndId: string | null;
}

/** Tage vor dem Einzugstag, ab denen eine Gutschrift zum Sammler passen kann (Wertstellung am Einzugstag, Buchung davor) */
const BEFORE_DAYS = 1;
/** Tage nach dem Einzugstag, bis zu denen eine Gutschrift noch zum Sammler passt */
const AFTER_DAYS = 30;

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

/** Lastschriften der Gutschrift: ein Sammler oder alle Sammler eines Einzugstags derselben Datei; null ohne Treffer */
export function findDirectDebitBatch(tx: DirectDebitTransaction, items: CollectedDirectDebit[]): CollectedDirectDebit[] | null {
  if (tx.amount <= 0) return null;
  const open = items.filter((i) => {
    if (i.state !== "eingereicht") return false;
    const offset = dayNumber(tx.bookingDate) - dayNumber(i.collectionDate);
    return offset >= -BEFORE_DAYS && offset <= AFTER_DAYS;
  });
  const groups = new Map<string, CollectedDirectDebit[]>();
  const add = (key: string, i: CollectedDirectDebit) => groups.set(key, [...(groups.get(key) ?? []), i]);
  for (const i of open) {
    add(`pmtinf|${i.paymentInfoId}`, i);
    // Die MsgId ist der Teil der PmtInfId vor dem letzten Bindestrich (sepa-lastschriften.ts)
    add(`tag|${i.paymentInfoId.replace(/-\d+$/, "")}|${i.collectionDate}`, i);
  }
  for (const group of groups.values()) {
    if (group.length > 1 && group.reduce((sum, i) => sum + i.amount, 0) === tx.amount) return group;
  }
  return null;
}

/**
 * Gründe der Rückgabe: deutsche Texte aus Anlage 3 der DK V3.9, Kap. 2.2.3.10.3; MD06 aus EPC173-14 v8.1 („Disputed
 * authorized transaction“, Erstattung binnen acht Wochen). Andere Codes erscheinen ohne Text.
 */
const REASONS: Record<string, string> = {
  AC01: "IBAN fehlerhaft",
  AC04: "Konto aufgelöst",
  AC06: "Konto gesperrt",
  AM04: "Rückgabe mangels Deckung",
  AM05: "Doppeleinreichung",
  MD01: "Kein gültiges Mandat",
  MD02: "Die Daten zum Mandat fehlen oder sind nicht korrekt",
  MD06: "Erstattung auf Verlangen des Zahlers",
  MD07: "Kontoinhaber verstorben",
  MS02: "Rückgabe durch den Zahler",
  MS03: "Grund nicht spezifiziert",
  SL01: "Spezifische Dienstleistung der Bank des Zahlers",
};

/** Codes der Rückgabe, die vorkommen: ExternalReturnReason1Code laut Anlage 3 (Kap. 2.2.3.10.3, 7.1.7.12) und EPC173-14 */
const KNOWN_CODES = [
  ...Object.keys(REASONS),
  "AG01",
  "AG02",
  "AM01",
  "AM02",
  "BE01",
  "BE05",
  "FF01",
  "RC01",
  "RR01",
  "RR02",
  "RR03",
  "RR04",
  "DUPL",
  "TECH",
  "FRAD",
  "AGNT",
  "CUTA",
  "UPAY",
  // EPC173-14 v8.1 (Guidance on Reason Codes for SDD R-transactions)
  "AC13",
  "CNOR",
  "DNOR",
  "ED05",
];
const REASON_CODE = new RegExp(`\\b(${KNOWN_CODES.join("|")})\\b`);

export function returnReason(text: string): { code: string; text: string | null } | null {
  const code = REASON_CODE.exec(text.toUpperCase())?.[1];
  return code ? { code, text: REASONS[code] ?? null } : null;
}

/** Hinweis der Bank auf eine Rückgabe im Text des Umsatzes */
const RETURN_WORDS = /r(ü|ue)ck(lastschrift|belastung|gabe)|\bRETURN\b|\bREJECT\b|\bREFUND\b/i;

const compact = (value: string) => value.replace(/\s+/g, "").toUpperCase();

/**
 * Lastschrift, die der (negative) Umsatz zurückgibt, und das Entgelt der Bank darüber; null ohne sicheren Bezug. Bezug
 * ist die EndToEndId oder ein Rückgabetext mit Mandatsreferenz oder Rechnungsnummer. Nur gutgeschriebene Lastschriften:
 * Vorher ist die Rechnung nicht bezahlt, und es gibt nichts wieder zu öffnen.
 */
export function findDirectDebitReturn(
  tx: DirectDebitTransaction,
  items: CollectedDirectDebit[],
): { item: CollectedDirectDebit; fee: Cents; reason: ReturnType<typeof returnReason> } | null {
  if (tx.amount >= 0) return null;
  const text = [tx.purpose, tx.bankReference ?? ""].join(" ");
  const looksLikeReturn = RETURN_WORDS.test(text);
  const haystack = compact([tx.endToEndId ?? "", tx.bankReference ?? "", tx.purpose].join(" "));
  const open = items.filter((i) => i.state === "gutgeschrieben" && -tx.amount >= i.amount);
  const byEndToEndId = open.filter((i) => tx.endToEndId === i.endToEndId || haystack.includes(compact(i.endToEndId)));
  const byText = (key: (i: CollectedDirectDebit) => string) => (looksLikeReturn ? open.filter((i) => haystack.includes(compact(key(i)))) : []);
  // Der stärkste Bezug zuerst; die Mandatsreferenz tragen alle Folgelastschriften eines Mandats und ist nur eindeutig sicher
  const matches = [byEndToEndId, byText((i) => `Rechnung ${i.invoiceNumber}`), byText((i) => i.mandateReference)].find((list) => list.length > 0) ?? [];
  const item = matches.length === 1 ? matches[0]! : null;
  return item ? { item, fee: -tx.amount - item.amount, reason: returnReason(text) } : null;
}
