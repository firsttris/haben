import type { PostfachBereitstellung } from "./postfach.ts";

/** Ergebnis einer ERiC-Bearbeitung, unabhängig davon, wer sie ausgeführt hat. */
export interface ElsterResult {
  ok: boolean;
  /** ERiC-Rückgabecode; 0 = ERIC_OK, -1 = Fehler außerhalb von ERiC */
  code: number;
  message: string;
  /** Inhalt des Rückgabepuffers (Validierungsfehler, Hinweise) */
  responseXml: string;
  /** Antwort des ELSTER-Servers, nur nach dem Senden */
  serverResponseXml: string;
  transferTicket?: string;
  /** Übertragungsprotokoll als PDF */
  pdf?: Uint8Array;
}

export interface SendOptions {
  /** Muss zum Testmerker im XML passen. */
  test: boolean;
  /** Übertragungsprotokoll als PDF drucken (Standard); Nachrichten an das Finanzamt haben keins */
  print?: boolean;
}

export interface PostfachOptions {
  test: boolean;
  /** Für den Download über Otto */
  herstellerId: string;
}

/** Antwort auf eine PostfachAnfrage samt abgeholter Anhänge; bestätigt ist damit noch nichts. */
export interface PostfachResult extends ElsterResult {
  bereitstellungen: PostfachBereitstellung[];
  dateien: { referenzId: string; inhalt?: Uint8Array; fehler?: string }[];
}

/** Alles, was die App von ELSTER weiß. ERiC bleibt dahinter verborgen. */
export interface ElsterClient {
  validate(xml: string): Promise<ElsterResult>;
  /** certificate: Inhalt der .pfx-Datei. Die PIN wird weder geloggt noch gespeichert. */
  send(xml: string, certificate: Uint8Array, pin: string, options: SendOptions): Promise<ElsterResult>;
  /** Sendet eine PostfachAnfrage und holt alle Anhänge ab. Bestätigt wird danach per send(). */
  fetchPostfach(xml: string, certificate: Uint8Array, pin: string, options: PostfachOptions): Promise<PostfachResult>;
}

export function failure(message: string, code = -1): ElsterResult {
  return { ok: false, code, message, responseXml: "", serverResponseXml: "" };
}
