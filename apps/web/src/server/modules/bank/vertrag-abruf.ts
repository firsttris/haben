import { type EbBalance, type EbTransaction, enableBankingDelivery, entryReferenceOf, OHNE_ENTRY_REFERENCE, type ParsedStatement } from "@haben/import";
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
  fetchFrom?: string;
}): { input: StoreBatchInput; hinweise: string[] } {
  const { batch, fallback } = enableBankingDelivery({
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
  // Vorgemerkte Umsätze und andere Status meldet schon der Kontoauszug (enableBankingStatement), die nicht doppelt
  const danach = batch.unsupported.filter((u) => u.reason.includes("nach dem abgerufenen Fenster")).length;
  const umsaetze = (n: number) => `${n} ${n === 1 ? "Umsatz" : "Umsätze"}`;
  const hinweise = [
    ...(ohneReferenz > 0 ? [`${umsaetze(ohneReferenz)} ohne Referenz der Bank (entry_reference): wie bisher am Inhalt erkannt.`] : []),
    ...(danach > 0 ? [`${umsaetze(danach)} nach dem abgerufenen Zeitraum nicht übernommen; der nächste Abruf holt ${danach === 1 ? "ihn" : "sie"}.`] : []),
    ...(fallback.size > 0 ? [`${umsaetze(fallback.size)} mit mehrfach vergebener Bankreferenz: am Inhalt erkannt.`] : []),
  ];
  return {
    input: {
      batch: { ...batch, unsupported: batch.unsupported.filter((u) => !u.reason.includes(OHNE_ENTRY_REFERENCE)) },
      binding: { provider: "enablebanking", externalAccountId: abruf.identificationHash, accountKind: "bank" },
      statement: abruf.statement,
      eventOf: entryReferenceOf(abruf.transactions, fallback),
      ...(fallback.size > 0 ? { fallbackEvents: new Set(fallback.values()) } : {}),
      source: abruf.source,
      ...(abruf.fetchFrom ? { fetchFrom: abruf.fetchFrom } : {}),
    },
    hinweise,
  };
}
