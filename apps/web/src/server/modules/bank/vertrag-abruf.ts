import { and, eq } from "drizzle-orm";
import {
  type EbAccount,
  type EbBalance,
  type EbTransaction,
  EnableBankingApiError,
  enableBankingBatch,
  entryReferenceOf,
  OHNE_ENTRY_REFERENCE,
  type ParsedStatement,
} from "@haben/import";
import { db, schema } from "../../db/index.ts";
import type { BankConnectionAccount } from "../../db/schema.ts";
import { BankError } from "./bank.ts";
import type { StoreBatchInput } from "./import-batch.ts";

/*
 * Ein Abruf über Enable Banking als Lieferung des Importvertrags (#306, Schritt 3). Kontokennung ist der
 * `identification_hash`, weil `entry_reference` nur je Hash eindeutig ist und eine IBAN auch ein Unterkonto in
 * Fremdwährung abdecken kann. Gebuchte Umsätze ohne `entry_reference` speichert Haben wie bisher und erkennt sie am Inhalt
 * (in #306 abgestimmt); sie stehen deshalb nicht unter `unsupported` und halten den Zeitraum nicht offen.
 */

/** Zeitpunkt mit Uhrzeit und Offset in Deutschland, damit sein Tag zum abgerufenen Fenster passt (`today()`) */
export function berlinTimestamp(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const offset = part("timeZoneName").replace("GMT", "") || "+00:00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}${offset}`;
}

/** Lieferung für `storeBatch` und die Hinweise, die nur im Ergebnis des Abrufs stehen */
export function abrufNachVertrag(abruf: {
  identificationHash: string;
  transactions: EbTransaction[];
  balances: EbBalance[];
  statement: ParsedStatement;
  dateFrom: string;
  dateTo: string;
  now: Date;
  fetchId: string;
  source: StoreBatchInput["source"];
}): { input: StoreBatchInput; hinweise: string[] } {
  const batch = enableBankingBatch({
    externalAccountId: abruf.identificationHash,
    transactions: abruf.transactions,
    balances: abruf.balances,
    // Ein Abrufstand nach heute (etwa nach zurückgestellter Uhr) ergäbe ein Fenster, das vor seinem Anfang endet
    dateFrom: [abruf.dateFrom, abruf.dateTo].sort()[0]!,
    dateTo: abruf.dateTo,
    fetchedAt: berlinTimestamp(abruf.now),
    fetchId: abruf.fetchId,
  });
  const ohneReferenz = batch.unsupported.filter((u) => u.reason.includes(OHNE_ENTRY_REFERENCE)).length;
  const hinweise =
    ohneReferenz > 0
      ? [`${ohneReferenz} ${ohneReferenz === 1 ? "Umsatz" : "Umsätze"} ohne Referenz der Bank (entry_reference): wie bisher am Inhalt erkannt.`]
      : [];
  return {
    input: {
      batch: { ...batch, unsupported: batch.unsupported.filter((u) => !u.reason.includes(OHNE_ENTRY_REFERENCE)) },
      binding: { provider: "enablebanking", externalAccountId: abruf.identificationHash, accountKind: "bank" },
      statement: abruf.statement,
      eventOf: entryReferenceOf(abruf.transactions),
      source: abruf.source,
    },
    hinweise,
  };
}

/**
 * Kontokennung für die Quellenbindung: gespeichert, sonst aus einer schon bestehenden Bindung des Kontos, sonst aus den
 * Kontodetails der Bank; null, wenn die Bank keine nennt. Ist die Bank nicht erreichbar, Fehler statt Rückfall auf den
 * Weg ohne Vertrag: Dessen Umsätze erkennte ein späterer Abruf mit Kennung nicht wieder.
 */
export async function kontokennung(account: BankConnectionAccount, details: () => Promise<EbAccount>): Promise<string | null> {
  if (account.identificationHash) return account.identificationHash;
  const [bound] = await db
    .select({ externalAccountId: schema.importSources.externalAccountId })
    .from(schema.importSources)
    .where(and(eq(schema.importSources.bankAccountId, account.bankAccountId), eq(schema.importSources.provider, "enablebanking")))
    .limit(1);
  if (bound) return bound.externalAccountId;
  if (account.identificationHash === null) return null;
  try {
    return (await details()).identification_hash || null;
  } catch (error) {
    if (error instanceof EnableBankingApiError && error.status === 404) return null;
    throw new BankError(`Kennung des Kontos bei der Bank nicht abrufbar (${error instanceof Error ? error.message : String(error)}); nichts gespeichert.`);
  }
}
