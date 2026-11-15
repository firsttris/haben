import { z } from "zod";

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
 * keine Kontokennung. `cutoverDate` ist der Stichtag gegen Dateiimporte: Bewegungen davor kommen aus Dateien, nicht aus
 * dieser Quelle; einen Abgleich über Betrag oder Text gibt es nicht (Entscheidung im Issue #306).
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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format JJJJ-MM-TT");
const text = z.string().trim().min(1);

const movementSchema = z.strictObject({
  /** Stabile Kennung des Ereignisses beim Anbieter (Enable Banking: entry_reference, nicht transaction_id) */
  sourceEventId: text,
  component: z.enum(MOVEMENT_COMPONENTS),
  kind: z.enum(MOVEMENT_KINDS),
  bookingDate: isoDate,
  valueDate: isoDate.optional(),
  /** Zeitstempel des Anbieters mit Offset, als Herkunft erhalten */
  sourceTimestamp: z.string().optional(),
  /** Ganze Cent, Eingang positiv, Ausgang negativ */
  amount: z.number().int(),
  currency: z.string().regex(/^[A-Z]{3}$/, "Währung als ISO-Code, etwa EUR"),
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
   * Abgerufenes Fenster. Eine Abfrage über mehrere Seiten sind mehrere Lieferungen mit demselben Fenster und fortlaufendem
   * `part.index` ab 0; die letzte trägt `part.last`. Erst alle Teile zusammen gelten als vollständig.
   */
  coverage: z.strictObject({ from: isoDate, to: isoDate }),
  part: z.strictObject({ index: z.number().int().min(0), last: z.boolean() }),
  movements: z.array(movementSchema),
  /** Gebuchter Saldo mit Stichtag, getrennt von den Bewegungen; Haben bucht daraus nichts aus */
  balances: z.array(z.strictObject({ date: isoDate, amount: z.number().int(), currency: z.string() })).default([]),
  /** Was der Connector nicht als gebuchte Bewegung einordnen konnte (unbekannter Status, nicht unterstütztes Ereignis) */
  unsupported: z.array(z.strictObject({ sourceEventId: z.string().optional(), reason: text })).default([]),
});

export type ImportBatch = z.infer<typeof batchSchema>;
export type ImportMovement = ImportBatch["movements"][number];
