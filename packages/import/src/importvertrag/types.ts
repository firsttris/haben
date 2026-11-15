import { z } from "zod";
import { parseDate } from "../text.ts";

/*
 * Gemeinsamer Importvertrag für Bank- und Zahlungsdienstleister-Connectoren (#306, Schritt 1). Ein Connector, intern wie
 * Enable Banking oder extern als eigener Dienst, liefert gebuchte Bewegungen in Lieferungen (Batches); Haben prüft sie mit
 * `validateBatch`, erkennt Wiederholungen und Konflikte mit `classifyBatch` und `classifyMovements` und rückt den
 * vollständig abgerufenen Zeitraum erst mit `advanceCheckpoint` vor. Der Vertrag ordnet nichts zu und bucht nichts; das
 * geschieht weiter im Bankabgleich. Speicherung, Migration und REST folgen in eigenen Schritten.
 */

export const IMPORT_CONTRACT_VERSION = 1;

/** Bankkonto oder Verrechnungskonto eines Zahlungsdienstleisters; beide bleiben getrennte Konten in Haben */
export type AccountKind = "bank" | "psp";

/**
 * Vom Nutzer bestätigte Verknüpfung einer Quelle (Anbieter und dessen Kontokennung) mit einem Konto in Haben. Sie gehört
 * Haben, nicht dem Connector, und überlebt neue Zugangsdaten und Zustimmungen: Sitzungs- oder Verbindungskennungen sind
 * keine Kontokennung. Bei Enable Banking ist das `identification_hash` des Kontos, nicht die `uid`, die nur in ihrer
 * Sitzung gilt ([API-Referenz](https://enablebanking.com/docs/api/reference/), AccountResource). `cutoverDate` ist der
 * Stichtag gegen Dateiimporte: Bewegungen davor kommen aus Dateien, nicht aus dieser Quelle; einen Abgleich über Betrag
 * oder Text gibt es nicht (Entscheidung im Issue #306).
 */
export interface SourceBinding {
  provider: string;
  externalAccountId: string;
  accountKind: AccountKind;
  /** YYYY-MM-DD, erster Tag, den diese Quelle liefert */
  cutoverDate?: string;
}

/**
 * Was die Bewegung ist. Eine Auszahlung (`payout`) auf ein eigenes Bankkonto bleibt Geldtransit; der Eingang auf der Bank
 * ist eine eigene Bewegung der Bankquelle und keine Dublette.
 */
export const MOVEMENT_KINDS = ["payment", "refund", "chargeback", "payout", "fee", "adjustment"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/**
 * Teil eines Ereignisses: der Hauptbetrag oder die vom Anbieter einbehaltene Gebühr. Ein Netto gibt es bewusst nicht:
 * Hauptbetrag und Gebühr ergeben es (+100,00 € Zahlung, −3,00 € Gebühr = +97,00 € auf dem Konto), ein zusätzlicher
 * Netto-Umsatz zählte doppelt. Je Ereignis gibt es jede Komponente höchstens einmal, so zählt jede Gebühr genau einmal.
 */
export const MOVEMENT_COMPONENTS = ["main", "fee"] as const;
export type MovementComponent = (typeof MOVEMENT_COMPONENTS)[number];

/** Kalendertag JJJJ-MM-TT, den es gibt („2026-02-30“ nicht) */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => parseDate(d) === d);
const currency = z.string().regex(/^[A-Z]{3}$/);
const text = z.string().trim().min(1);

const movementSchema = z.strictObject({
  /**
   * Stabile Kennung des Ereignisses beim Anbieter. Enable Banking: `entry_reference`, eindeutig für Konten mit demselben
   * `identification_hash`; `transaction_id` kann sich ändern und ist kein Ersatz. Fehlt `entry_reference`, ordnet der
   * Connector den Umsatz unter `unsupported` ein (API-Referenz, Transaction).
   */
  sourceEventId: text,
  component: z.enum(MOVEMENT_COMPONENTS),
  kind: z.enum(MOVEMENT_KINDS),
  bookingDate: isoDate,
  valueDate: isoDate.optional(),
  /** Zeitstempel des Anbieters mit Offset, als Herkunft erhalten */
  sourceTimestamp: z.string().optional(),
  /** Ganze Cent, Eingang positiv, Ausgang negativ */
  amount: z.number().int(),
  /** ISO 4217, etwa EUR */
  currency,
  /** Fehlende Angaben leer lassen, nicht erfinden */
  counterpartyName: z.string().optional(),
  counterpartyIban: z.string().optional(),
  purpose: z.string().default(""),
  references: z
    .strictObject({
      providerReference: z.string().optional(),
      eventCode: z.string().optional(),
      endToEndId: z.string().optional(),
      /** Bei Erstattung und Rückbelastung: das ursprüngliche Ereignis, wenn der Anbieter es nennt */
      relatedEventId: z.string().optional(),
      payoutId: z.string().optional(),
      orderId: z.string().optional(),
    })
    .default({}),
});

export const batchSchema = z.strictObject({
  contractVersion: z.number().int(),
  provider: text,
  externalAccountId: text,
  /** Vom Connector gewählt; dieselbe Lieferung nach verlorener Antwort kommt mit demselben Schlüssel und Inhalt */
  idempotencyKey: text,
  fetchedAt: z.string().datetime({ offset: true }),
  /**
   * Abgerufenes Fenster. Ein Abruf über mehrere Seiten sind mehrere Lieferungen mit derselben `part.fetchId`, demselben
   * Fenster und fortlaufendem `part.index` ab 0; die letzte trägt `part.last`. Erst alle Teile eines Abrufs zusammen
   * gelten als vollständig; ein neuer Abruf desselben Fensters, etwa nach einem Abbruch, bekommt eine neue `fetchId`.
   */
  coverage: z.strictObject({ from: isoDate, to: isoDate }),
  part: z.strictObject({ fetchId: text, index: z.number().int().min(0), last: z.boolean() }),
  movements: z.array(movementSchema),
  /** Gebuchter Saldo mit Stichtag, getrennt von den Bewegungen; Haben bucht daraus nichts aus */
  balances: z.array(z.strictObject({ date: isoDate, amount: z.number().int(), currency })).default([]),
  /** Was der Connector nicht als gebuchte Bewegung einordnen konnte (unbekannter Status, nicht unterstütztes Ereignis) */
  unsupported: z.array(z.strictObject({ sourceEventId: z.string().optional(), reason: text })).default([]),
});

export type ImportBatch = z.infer<typeof batchSchema>;
export type ImportMovement = ImportBatch["movements"][number];
