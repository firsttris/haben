import type { ClientResponse, FinTSClient } from "lib-fints";

/*
 * lib-fints 1.5.3 fängt Fehler beim Lesen von MT940 und CAMT ab (StatementInteractionMT940 und StatementInteractionCAMT,
 * handleResponse), schreibt sie nur mit console.warn ins Log und gibt den Abruf als gelungen zurück, ohne Umsätze. Haben
 * hielte die Tage dann für abgerufen und holte sie nie wieder: Der nächste Abruf beginnt sieben Tage vor dem letzten.
 * Deshalb hält Haben fest, was lib-fints beim Lesen einer Antwort meldet, und fintsUmsaetze macht daraus einen Fehler.
 * Die Datei fällt weg, sobald lib-fints den Fehler selbst meldet; der Test mit unlesbarem MT940 in sitzung.test.ts zeigt
 * dann, ob das stimmt.
 *
 * Dieselbe Stelle hält auch fest, in welchem Format die Bank geantwortet hat: lib-fints wählt CAMT oder MT940 selbst
 * (getAccountStatements, preferCamt) und sagt es nicht. map.ts braucht es für das Jahr des Buchungstags aus MT940.
 */

/** MT940 (HKKAZ) oder CAMT (HKCAZ) */
export type UmsatzFormat = "MT940" | "CAMT";

export interface Lesefehler {
  format: UmsatzFormat;
  /** Text des Fehlers aus lib-fints */
  grund: string;
}

/** Antwort von lib-fints → was beim Lesen schiefging */
const fehler = new WeakMap<object, Lesefehler>();

/** Antwort von lib-fints → Format der Umsätze darin */
const formate = new WeakMap<object, UmsatzFormat>();

/** Ein Auftrag in lib-fints (CustomerOrderInteraction), soweit Haben ihn hier braucht */
interface Auftrag {
  segId: string;
  handleResponse(message: unknown, response: ClientResponse): void;
}

/**
 * Hängt sich an jeden Auftrag des Clients, bevor sein Dialog läuft: startCustomerOrderInteraction ist in lib-fints
 * privat, bekommt den Auftrag aber als einzige Stelle vorher, und derselbe Auftrag liest auch die Antwort nach einer TAN.
 * handleResponse läuft synchron; solange kommt kein anderer Code an die Reihe, der console.warn bräuchte. Die Meldung geht
 * nicht ins Log, sie kommt als Fehler des Abrufs zurück.
 */
export function lesefehlerMerken(client: FinTSClient): void {
  const intern = client as unknown as { startCustomerOrderInteraction(auftrag: Auftrag): Promise<ClientResponse> };
  const starten = intern.startCustomerOrderInteraction.bind(client);
  intern.startCustomerOrderInteraction = (auftrag) => {
    const lesen = auftrag.handleResponse.bind(auftrag);
    const format: UmsatzFormat | undefined = auftrag.segId === "HKCAZ" ? "CAMT" : auftrag.segId === "HKKAZ" ? "MT940" : undefined;
    auftrag.handleResponse = (message, response) => {
      if (format) formate.set(response, format);
      const warn = console.warn;
      console.warn = (...args: unknown[]) => {
        const error = args.find((a) => a instanceof Error);
        if (!fehler.has(response)) {
          fehler.set(response, { format: format ?? "MT940", grund: error instanceof Error ? error.message : args.join(" ") });
        }
      };
      try {
        lesen(message, response);
      } finally {
        console.warn = warn;
      }
    };
    return starten(auftrag);
  };
}

/** Was lib-fints beim Lesen dieser Antwort gemeldet hat; undefined, wenn sie sich lesen ließ */
export function lesefehler(response: object): Lesefehler | undefined {
  return fehler.get(response);
}

/** Format der Umsätze in dieser Antwort; undefined, wenn sie keine Umsätze enthielt */
export function umsatzFormat(response: object): UmsatzFormat | undefined {
  return formate.get(response);
}
