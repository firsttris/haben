import type * as zc from "zod/v4/core";
import type { Millis } from "./invoice.ts";
import type { BasisPoints, Cents, Prozent } from "./money.ts";

/*
 * Zod-Schemas, deren Ergebnis die Einheit trägt (#1132): inCents(z.int().check(…)). Zurück kommt dasselbe Schema, zur
 * Laufzeit, in den Fehlermeldungen und im JSON-Schema (OpenAPI) ändert sich nichts, nur der Typ des Ergebnisses. Die
 * Eingabe bleibt eine Zahl ohne Einheit, damit Aufrufer im Browser weiter Zahlen schicken. Ganze Zahl im sicheren Bereich
 * prüft schon Zod (`z.int()`, `.int()`).
 */

export function inCents<T extends zc.$ZodType<number, number>>(schema: T): T & zc.$ZodType<Cents, number> {
  return schema;
}

export function inBasisPoints<T extends zc.$ZodType<number, number>>(schema: T): T & zc.$ZodType<BasisPoints, number> {
  return schema;
}

export function inMillis<T extends zc.$ZodType<number, number>>(schema: T): T & zc.$ZodType<Millis, number> {
  return schema;
}

export function inProzent<T extends zc.$ZodType<number, number>>(schema: T): T & zc.$ZodType<Prozent, number> {
  return schema;
}
