import { type EbBalance, type EbTransaction, enableBankingBatch, OHNE_ENTRY_REFERENCE, validateBatch } from "@haben/import";

/*
 * Schritt 2 aus #306: Jeder Abruf über Enable Banking läuft zusätzlich durch den Importvertrag. Die Prüfung meldet nur,
 * gespeichert wird weiter über `enableBankingStatement` und `storeStatement` wie bisher; verbindlich wird sie mit der
 * Quellenbindung in Schritt 3. Bis dahin ist die Kontokennung die IBAN, über die Haben das Konto heute schon zuordnet:
 * Den `identification_hash` speichert die Verbindung noch nicht (`BankConnectionAccount`), und mit dem Schlüssel wird
 * hier nichts gespeichert. Ab Schritt 3 gilt der Hash (`importvertrag/types.ts`), weil `entry_reference` nur je Hash
 * eindeutig ist und eine IBAN auch ein Unterkonto in Fremdwährung abdecken kann.
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

/** Hinweise für das Ergebnis des Abrufs; was `enableBankingStatement` schon meldet (vorgemerkt, Status), nicht doppelt */
export function vertragHinweise(abruf: {
  iban: string;
  transactions: EbTransaction[];
  balances: EbBalance[];
  dateFrom: string;
  dateTo: string;
  now: Date;
  fetchId: string;
}): string[] {
  const batch = enableBankingBatch({
    externalAccountId: abruf.iban,
    transactions: abruf.transactions,
    balances: abruf.balances,
    dateFrom: abruf.dateFrom,
    dateTo: abruf.dateTo,
    fetchedAt: berlinTimestamp(abruf.now),
    fetchId: abruf.fetchId,
  });
  const result = validateBatch(batch, { provider: "enablebanking", externalAccountId: abruf.iban, accountKind: "bank" });
  if (!result.ok) return [`Prüfung nach dem Importvertrag (#306): ${result.problems.join(" ")}`];
  const ohneReferenz = batch.unsupported.filter((u) => u.reason.includes(OHNE_ENTRY_REFERENCE)).length;
  const hinweise: string[] = [];
  if (ohneReferenz > 0) {
    hinweise.push(
      `${ohneReferenz} ${ohneReferenz === 1 ? "Umsatz" : "Umsätze"} ohne Referenz der Bank (entry_reference): gespeichert wie bisher; ein späterer Abruf über den Importvertrag (#306) erkennt sie nicht sicher wieder.`,
    );
  }
  return [...hinweise, ...result.hints];
}
