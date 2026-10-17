import { TEST_HERSTELLER_ID, type ElsterClient, type ElsterResult } from "@haben/elster";
import { desc, eq, sql } from "drizzle-orm";
import { decrypt } from "./crypto.ts";
import { db, schema } from "./db/index.ts";
import { UserError } from "./errors.ts";

/*
 * ELSTER-Gateway (#81): alles, was jede Übermittlung an die Finanzverwaltung braucht, an einer Stelle.
 *
 * - Zugang: Hersteller-ID (ERiC 43 sperrt die Test-Hersteller-ID 74931 auch für Testfälle, deshalb die eigene, falls
 *   vorhanden) und keine Echtübermittlung mit dem simulierten Client.
 * - Signatur: aktives Zertifikat und PIN, eingegeben oder gespeichert.
 * - Sendesperre: Eine Echtübermittlung desselben Vorgangs läuft nie zweimal gleichzeitig. Wo der Vorgang einen Status hat
 *   (Voranmeldung, Jahreserklärung), sieht der zweite Aufruf danach „bereits gesendet“; Nachrichten und Anträge ohne
 *   Status laufen nacheinander, gesendet werden sie dann zweimal.
 * - Protokoll: Jeder Versuch wird gespeichert; scheitert das nach erfolgter Echtübermittlung, bleibt der Nachweis im
 *   Server-Log, und der Nutzer erfährt, dass er nicht erneut senden soll.
 *
 * Die Bestätigung der Datenschutzhinweise prüft der Client selbst bei jedem Aufruf (elster.ts, mitDatenschutzPruefung).
 * Voranmeldung, Jahreserklärungen, Nachrichten, Bankverbindung, Postfach, Belegabruf und Berechtigungen nutzen das Gateway.
 */

/** Version, mit der sich Haben bei ELSTER meldet */
export const PRODUKT_VERSION = "0.1.0";

export class ElsterGatewayError extends UserError {}

/** validate: nur prüfen; test: Testübermittlung; send: echt */
export type ElsterVorgang = "validate" | "test" | "send";

/** Wie der Vorgang in Meldungen heißt, z. B. „Echtübermittlung“ oder „echter Abruf“ */
export interface Bezeichnung {
  /** „Für die Echtübermittlung fehlt die Hersteller-ID“ */
  echt: string;
  /** „Ohne ERiC ist keine Echtübermittlung möglich; …“ */
  ohneEric: string;
}

export const UEBERMITTLUNG: Bezeichnung = {
  echt: "die Echtübermittlung",
  ohneEric: "Ohne ERiC ist keine Echtübermittlung möglich; Prüfen und Testübermittlung laufen nur simuliert.",
};
export const ABRUF: Bezeichnung = {
  echt: "den echten Abruf",
  ohneEric: "Ohne ERiC ist kein echter Abruf möglich; der Testabruf läuft nur simuliert.",
};
export const SENDEN: Bezeichnung = {
  echt: "das echte Senden",
  ohneEric: "Ohne ERiC ist kein echtes Senden möglich; Prüfen und Testübermittlung laufen nur simuliert.",
};

export async function loadActiveCertificate() {
  const [row] = await db
    .select()
    .from(schema.elsterCertificates)
    .where(eq(schema.elsterCertificates.active, true))
    .orderBy(desc(schema.elsterCertificates.uploadedAt))
    .limit(1);
  return row ?? null;
}

export interface Zugang {
  test: boolean;
  herstellerId: string;
}

/** Prüft, ob der Vorgang mit diesem Client und dieser Hersteller-ID möglich ist */
export function zugang(client: ElsterClient, vorgang: ElsterVorgang, herstellerId: string | undefined, bezeichnung: Bezeichnung = UEBERMITTLUNG): Zugang {
  const test = vorgang !== "send";
  const id = herstellerId || (test ? TEST_HERSTELLER_ID : undefined);
  if (!id) throw new ElsterGatewayError(`Für ${bezeichnung.echt} fehlt die Hersteller-ID (ELSTER_HERSTELLER_ID).`);
  // Der simulierte Client sendet nichts; eine „Echtübermittlung“ würde sonst festschreiben, ohne dass etwas beim Finanzamt ist
  if (!test && isSimulated(client)) throw new ElsterGatewayError(bezeichnung.ohneEric);
  return { test, herstellerId: id };
}

export const isSimulated = (client: ElsterClient) => "isFake" in client && Boolean((client as { isFake?: boolean }).isFake);

/**
 * Zertifikat und PIN zum Signieren. Ohne eingegebene PIN gilt die gespeicherte, wenn `gespeichertePin` erlaubt ist
 * (Postfach, Belegabruf, Berechtigungen; die Oberfläche zeigt das im PIN-Feld an).
 */
export async function signatur(options: { pin?: string; gespeichertePin?: boolean }): Promise<{ pfx: Uint8Array; pin: string }> {
  if (!options.pin && !options.gespeichertePin) throw new ElsterGatewayError("Die Zertifikats-PIN fehlt.");
  const certificate = await loadActiveCertificate();
  if (!certificate) throw new ElsterGatewayError("Es ist kein ELSTER-Zertifikat hinterlegt.");
  const pin = options.pin || (options.gespeichertePin && certificate.pinCiphertext ? new TextDecoder().decode(decrypt(certificate.pinCiphertext)) : "");
  if (!pin) throw new ElsterGatewayError("Die Zertifikats-PIN fehlt.");
  return { pfx: decrypt(certificate.ciphertext), pin };
}

/**
 * Echtübermittlung unter Sperre: Ein zweiter Aufruf (Doppelklick) wartet, bis der erste protokolliert ist,
 * und prüft den Status erst danach. Die Transaktion hält nur die Sperre, gearbeitet wird auf anderen Verbindungen:
 * Das Protokoll einer erfolgten Übermittlung darf nicht mit einem späteren Fehler zurückgerollt werden.
 */
export function underSendLock<T>(key: string, vorgang: ElsterVorgang, work: () => Promise<T>): Promise<T> {
  if (vorgang !== "send") return work();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    return work();
  });
}

/** Protokolliert einen Versuch. Scheitert das nach erfolgter Echtübermittlung, bleibt der Nachweis wenigstens im Server-Log. */
export async function protocolSubmission(vorgang: ElsterVorgang, result: ElsterResult, xml: string, write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (error) {
    if (vorgang !== "send" || !result.ok) throw error;
    console.error("ELSTER: Echtübermittlung erfolgt, Protokoll nicht gespeichert", { transferTicket: result.transferTicket, requestXml: xml }, error);
    throw new UserError(
      `Die Übermittlung ist erfolgt (Transferticket ${result.transferTicket ?? "unbekannt"}), ließ sich aber nicht speichern. Bitte nicht erneut senden; Transferticket und gesendete Daten stehen im Server-Log.`,
      { cause: error },
    );
  }
}

export interface Uebermittlung<T> {
  /** Schlüssel der Sendesperre, z. B. haben.ustva.<id> */
  sperre: string;
  vorgang: ElsterVorgang;
  herstellerId: string | undefined;
  pin?: string;
  gespeichertePin?: boolean;
  bezeichnung?: Bezeichnung;
  /** Unter der Sperre, vor dem Senden: Zustand prüfen (z. B. schon gesendet?) und das XML bauen */
  vorbereiten: (zugang: Zugang) => Promise<{ xml: string; daten: T }>;
  /** Protokoll speichern, bei Erfolg auch den Vorgang festschreiben */
  protokollieren: (result: ElsterResult, xml: string, daten: T, zugang: Zugang) => Promise<unknown>;
  /** Druck des Protokoll-PDF (Standard: ja) */
  print?: boolean;
}

/** Ganzer Ablauf einer Übermittlung: Sperre, Zugang, XML, Prüfen oder Senden, Protokoll */
export function uebermitteln<T>(client: ElsterClient, u: Uebermittlung<T>): Promise<ElsterResult> {
  return underSendLock(u.sperre, u.vorgang, async () => {
    const z = zugang(client, u.vorgang, u.herstellerId, u.bezeichnung);
    const { xml, daten } = await u.vorbereiten(z);
    let result: ElsterResult;
    if (u.vorgang === "validate") {
      result = await client.validate(xml);
    } else {
      const { pfx, pin } = await signatur({ pin: u.pin, gespeichertePin: u.gespeichertePin });
      result = await client.send(xml, pfx, pin, { test: z.test, ...(u.print === false ? { print: false } : {}) });
    }
    await protocolSubmission(u.vorgang, result, xml, () => u.protokollieren(result, xml, daten, z));
    return result;
  });
}

/**
 * Vorbereitung für Abrufe und Anträge (Belegabruf, Berechtigungen): Zugang, Zertifikat und PIN. Ohne eingegebene PIN gilt
 * die gespeicherte: Sie wird beim Postfachabruf hinterlegt, aber auch hier genutzt; die Oberfläche zeigt das im PIN-Feld an.
 */
export async function prepareAbruf(client: ElsterClient, options: { kind: "test" | "send"; pin?: string; herstellerId?: string }) {
  const { test, herstellerId } = zugang(client, options.kind, options.herstellerId, ABRUF);
  const { pfx, pin } = await signatur({ pin: options.pin, gespeichertePin: true });
  return { test, herstellerId, pfx, pin };
}
