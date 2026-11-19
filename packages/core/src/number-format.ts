/*
 * Nummernformate für Rechnungen und Angebote, z. B. "RE-{JJJJ}-{NNN}" → "RE-2026-034".
 *
 * Platzhalter: {JJJJ} vierstelliges Jahr, {JJ} zweistelliges Jahr, {MM} zweistelliger Monat, alle aus dem Belegdatum,
 * {N} bis {NNNNNN} die laufende Nummer mit so vielen Stellen mindestens und {KUNDENNR} die Kundennummer des Käufers.
 * Je Nummernkreis beginnt der Zähler jedes Jahr bei 1 oder läuft durch (counterCircle, number-counter.ts). Beginnt er
 * jährlich neu, ist erst mit dem Jahr im Format jede Nummer eindeutig (§ 14 Abs. 4 Nr. 4 UStG); einmalig muss sie nur
 * sein, jährlich neu oder durchlaufend ist beides zulässig (UStAE 14.5 Abs. 10). Weil Jahr, Monat und Text feste Breite
 * haben und nur die laufende Nummer wächst, ergibt ein Format ohne {KUNDENNR} nie zweimal dieselbe Nummer. Die
 * Kundennummer ist variabel breit, deshalb darf sie nicht direkt neben der laufenden Nummer stehen ({KUNDENNR}{NNN}
 * ergäbe aus "1004" + 2001 und "10042" + 1 beides "10042001"); den Rest fängt die Prüfung auf schon vergebene Nummern
 * beim Festschreiben (documentNumber in number-counter.ts).
 */

export const DEFAULT_INVOICE_NUMBER_FORMAT = "{JJJJ}-{NNN}";
export const DEFAULT_QUOTE_NUMBER_FORMAT = "AN-{JJJJ}-{NNN}";
/** Vorschlag für Kundennummern; deren Zähler läuft durch, ohne Jahr */
export const DEFAULT_CUSTOMER_NUMBER_FORMAT = "K-{NNNN}";

export const MAX_NUMBER_FORMAT_LENGTH = 30;

/**
 * So lang darf eine Belegnummer höchstens sein: DATEV liest im Belegfeld 1 nur 36 Zeichen („ASCII-Import:
 * Feldbeschreibungen für Standardformate“, Dok.-Nr. 1003221, Feld 11); der Export kürzt ohne Rückmeldung, deshalb hält
 * das Festschreiben längere Nummern auf. Erst mit {KUNDENNR} kann eine Nummer das Format übersteigen (Kundennummern
 * bis zu 40 Zeichen).
 */
export const MAX_DOCUMENT_NUMBER_LENGTH = 36;

const PLACEHOLDER = /\{([^{}]*)\}/g;
const COUNTER = /^N{1,6}$/;
const YEAR = /^(JJJJ|JJ)$/;
const MONTH = /^MM$/;
const CUSTOMER = "KUNDENNR";
// Die Nummer steht in Dateinamen und im Verwendungszweck: kein Leerzeichen, kein Schrägstrich
const LITERAL = /^[A-Za-z0-9._-]*$/;
// Kundennummer und laufende Nummer sind beide variabel breit: direkt nebeneinander wäre die Nummer nicht mehr eindeutig
const CUSTOMER_NEXT_TO_COUNTER = /\{KUNDENNR\}\{N{1,6}\}|\{N{1,6}\}\{KUNDENNR\}/;

/**
 * Nummer aus Format, Belegdatum (JJJJ-MM-TT) und laufender Nummer; das Format ist mit numberFormatError geprüft. Jahr
 * und Monat kommen aus dem Rechnungs- bzw. Angebotsdatum, nicht aus dem heutigen Tag (#328). {KUNDENNR} wird zur
 * Kundennummer des Käufers; ohne Angabe bleibt der Platzhalter stehen (Vorschauen ohne Kunden).
 */
export function formatDocumentNumber(format: string, date: string, counter: number, customerNumber?: string): string {
  const year = Number(date.slice(0, 4));
  return format.replace(PLACEHOLDER, (_, name: string) => {
    if (name === "JJJJ") return String(year);
    if (name === "JJ") return String(year % 100).padStart(2, "0");
    if (name === "MM") return date.slice(5, 7);
    if (name === CUSTOMER) return customerNumber ?? `{${CUSTOMER}}`;
    return String(counter).padStart(name.length, "0");
  });
}

/** Ob das Format die Kundennummer des Käufers enthält */
export function usesCustomerNumber(format: string): boolean {
  return format.includes(`{${CUSTOMER}}`);
}

/**
 * Warum eine Kundennummer für {KUNDENNR} nicht taugt, als Satz für die Oberfläche; null = in Ordnung. Sie steht in
 * Dateinamen und im Verwendungszweck: dieselbe Zeichenregel wie für den Text im Format.
 */
export function customerNumberProblem(kundennummer: string | null | undefined): string | null {
  if (!kundennummer?.trim()) {
    return `Der Kunde braucht eine Kundennummer, weil das Nummernformat {${CUSTOMER}} enthält.`;
  }
  if (!LITERAL.test(kundennummer)) {
    return "Die Kundennummer darf nur Buchstaben, Ziffern, Bindestrich, Unterstrich und Punkt enthalten, weil sie in der Belegnummer steht.";
  }
  return null;
}

/**
 * Warum eine Belegnummer für DATEV zu lang ist, als Satz für die Oberfläche; null = in Ordnung. Zwei Nummern, die im
 * Belegfeld 1 gleich aussehen, verwechseln dort die offenen Posten.
 */
export function documentNumberLengthProblem(number: string): string | null {
  if (number.length <= MAX_DOCUMENT_NUMBER_LENGTH) return null;
  return `Die Nummer ${number} ist länger als ${MAX_DOCUMENT_NUMBER_LENGTH} Zeichen; DATEV übernimmt nur ${MAX_DOCUMENT_NUMBER_LENGTH} Zeichen als Belegnummer. Bitte eine kürzere Kundennummer oder ein kürzeres Nummernformat wählen.`;
}

/**
 * Belegfeld 1 erlaubt nur Ziffern, Buchstaben und $ & % * + - /, höchstens 36 Zeichen; unzulässig sind „insbesondere
 * Leerzeichen, Umlaute, Punkt, Komma, Semikolon und Doppelpunkt“ (DATEV „ASCII-Import: Feldbeschreibungen für
 * Standardformate“, Dok.-Nr. 1003221, Stand 13.08.2026, Abschnitt 3, Feld 11, https://apps.datev.de/help-center/documents/1003221).
 * Der Punkt aus dem Nummernformat wird zu „-“, damit `RE.2026.001` als `RE-2026-001` erkennbar bleibt; alles andere
 * außerhalb der Liste fällt weg (#675). Der DATEV-Export schreibt Belegnummern so ins Belegfeld 1 (datev-export.ts);
 * beim Festschreiben hält takeInvoiceNumber Nummern auf, die dort aussehen wie eine schon vergebene (#1426).
 */
export function voucherField(value: string): string {
  return value
    .replace(/\./g, "-")
    .replace(/[^A-Za-z0-9$&%*+\-/]/g, "")
    .slice(0, MAX_DOCUMENT_NUMBER_LENGTH);
}

/**
 * Kundennummer, mit der Storno und Rechnungskorrektur im gemeinsamen Kreis bei {KUNDENNR} nummeriert werden: die
 * festgeschriebene des Originals, solange sie taugt, sonst die heutige des Kontakts (#1426). Im Kundenkreis gehört
 * die Nummer zum Kreis und nimmt immer die des Kontakts. Was übrig bleibt, meldet customerNumberProblem.
 */
export function effectiveCustomerNumber(
  buyer: { kundennummer?: string | null } | null | undefined,
  contact: { kundennummer?: string | null } | null | undefined,
): string | undefined {
  const original = buyer?.kundennummer;
  return original && !customerNumberProblem(original) ? original : (contact?.kundennummer ?? undefined);
}

/**
 * Schlüssel des Zählers: das Jahr des Belegdatums, wenn der Zähler jedes Jahr neu beginnt, sonst 0 für den einen
 * durchlaufenden Kreis. So steht er in den Zählertabellen und in number_year der festgeschriebenen Belege.
 */
export function counterCircle(running: boolean, date: string): number {
  return running ? 0 : Number(date.slice(0, 4));
}

/** Zuletzt festgeschriebene Rechnung eines Nummernkreises (für die Datumsprüfung beim Festschreiben, #713) */
export type FinalizedCircleRef = { number: string; issueDate: string };

/**
 * Schlüssel eines Nummernkreises in lastFinalizedByCircle und numberCounters: das Jahr (0 beim durchlaufenden Zähler),
 * beim Zähler je Kunde Jahr:Kontakt (#1426). Der gemeinsame Kreis trägt keinen Kontakt und heißt wie bisher.
 */
export function circleKey(year: number, contactId: string | null): string {
  return contactId === null ? String(year) : `${year}:${contactId}`;
}

/**
 * Gibt die zuletzt festgeschriebene Rechnung des Nummernkreises zurück, wenn das gewählte Rechnungsdatum davor liegt;
 * sonst null. Beim Wechsel auf den durchlaufenden Zähler gilt vor der ersten neuen Rechnung noch das jüngste Jahr —
 * beim Zähler je Kunde das jüngste Jahr desselben Kundenkreises (#1426).
 */
export function issueDateBeforeLastFinalized(
  byCircle: Record<string, FinalizedCircleRef>,
  running: boolean,
  issueDate: string,
  contactId: string | null = null,
): FinalizedCircleRef | null {
  if (!issueDate) return null;
  const circle = counterCircle(running, issueDate);
  let last = byCircle[circleKey(circle, contactId)];
  if (!last && running) {
    const suffix = contactId === null ? null : `:${contactId}`;
    const years = Object.keys(byCircle)
      .filter((key) => (suffix === null ? !key.includes(":") : key.endsWith(suffix)))
      .map((key) => Number(key.split(":")[0]))
      .filter((y) => y > 0);
    if (years.length > 0) last = byCircle[circleKey(Math.max(...years), contactId)];
  }
  if (!last || issueDate >= last.issueDate) return null;
  return last;
}

/**
 * Warum ein Format nicht taugt, als Satz für die Oberfläche; null = in Ordnung. requireYear: false für Nummern, deren
 * Zähler nicht jährlich neu beginnt (Kundennummern, durchlaufende Nummernkreise); dort ist das Jahr erlaubt, aber nicht
 * nötig. allowCustomer erlaubt {KUNDENNR}: Rechnungen und Angebote tragen die Nummer ihres Käufers, für die Vergabe
 * neuer Kundennummern ergäbe der Platzhalter keinen Sinn. requireCustomer verlangt {KUNDENNR}: beim Zähler je Kunde
 * muss die Nummer aus dem Kreis ablesbar bleiben, der Platzhalter ist dann auch ohne allowCustomer erlaubt (#1426).
 */
export function numberFormatError(
  format: string,
  { requireYear = true, allowCustomer = false, requireCustomer = false }: { requireYear?: boolean; allowCustomer?: boolean; requireCustomer?: boolean } = {},
): string | null {
  if (format.length > MAX_NUMBER_FORMAT_LENGTH) return `Das Format darf höchstens ${MAX_NUMBER_FORMAT_LENGTH} Zeichen lang sein.`;
  const names = [...format.matchAll(PLACEHOLDER)].map((m) => m[1]!);
  const customerAllowed = allowCustomer || requireCustomer;
  const unknown = names.find((name) => !COUNTER.test(name) && !YEAR.test(name) && !MONTH.test(name) && !(customerAllowed && name === CUSTOMER));
  if (unknown !== undefined)
    return `Den Platzhalter {${unknown}} gibt es nicht. Möglich sind {JJJJ}, {JJ}, {MM}${customerAllowed ? `, {${CUSTOMER}}` : ""} und {N} bis {NNNNNN}.`;
  if (!LITERAL.test(format.replace(PLACEHOLDER, ""))) {
    return "Außerhalb der Platzhalter gehen nur Buchstaben, Ziffern, Bindestrich, Unterstrich und Punkt.";
  }
  if (names.filter((name) => name === CUSTOMER).length > 1) return `Der Platzhalter {${CUSTOMER}} darf nur einmal vorkommen.`;
  if (customerAllowed && CUSTOMER_NEXT_TO_COUNTER.test(format)) {
    return `Der Platzhalter {${CUSTOMER}} darf nicht direkt neben der laufenden Nummer stehen, sonst wird die Nummer nicht mehr eindeutig.`;
  }
  const counters = names.filter((name) => COUNTER.test(name)).length;
  if (counters === 0) return "Das Format braucht die laufende Nummer, z. B. {NNN}.";
  if (counters > 1) return "Die laufende Nummer darf nur genau einmal vorkommen.";
  if (requireYear && !names.some((name) => YEAR.test(name)))
    return "Das Format braucht das Jahr ({JJJJ} oder {JJ}), weil die laufende Nummer jedes Jahr neu beginnt.";
  if (requireCustomer && !names.some((name) => name === CUSTOMER))
    return `Das Format braucht die Kundennummer ({${CUSTOMER}}), weil jeder Kunde einen eigenen Nummernkreis bekommt.`;
  return null;
}
