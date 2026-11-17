import type { ClientResponse, FinTSClient } from "lib-fints";

/*
 * lib-fints 1.5.3 fängt Fehler beim Lesen von MT940 und CAMT ab (StatementInteractionMT940 und StatementInteractionCAMT,
 * handleResponse), schreibt sie nur mit console.warn ins Log und gibt den Abruf als gelungen zurück, ohne Umsätze. Haben
 * hielte die Tage dann für abgerufen und holte sie nie wieder: Der nächste Abruf beginnt sieben Tage vor dem letzten.
 * Deshalb hält Haben fest, was lib-fints beim Lesen einer Antwort meldet, und fintsUmsaetze macht daraus einen Fehler.
 * Die Datei fällt weg, sobald lib-fints den Fehler selbst meldet; der Test mit unlesbarem MT940 in sitzung.test.ts zeigt
 * dann, ob das stimmt.
 */

export interface Lesefehler {
  /** MT940 (HKKAZ) oder CAMT (HKCAZ) */
  format: string;
  /** Text des Fehlers aus lib-fints */
  grund: string;
}

/** Antwort von lib-fints → was beim Lesen schiefging */
const fehler = new WeakMap<object, Lesefehler>();

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
    auftrag.handleResponse = (message, response) => {
      const warn = console.warn;
      console.warn = (...args: unknown[]) => {
        const error = args.find((a) => a instanceof Error);
        if (!fehler.has(response)) {
          fehler.set(response, { format: auftrag.segId === "HKCAZ" ? "CAMT" : "MT940", grund: error instanceof Error ? error.message : args.join(" ") });
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
