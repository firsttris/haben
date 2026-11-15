import { parseDateSearch, parseEuroSearchRange } from "@haben/core";
import type { Rolle } from "../../lib/rollen.ts";

/** Gruppen der Schnellsuche, wie sie `CommandPaletteResult` führt */
export const PALETTE_GROUPS = [
  "contacts",
  "invoices",
  "quotes",
  "documents",
  "bankTransactions",
  "bookings",
  "accounts",
  "recurringInvoices",
  "recurringDocuments",
  "articles",
  "textBlocks",
  "serviceEntries",
  "assets",
  "loans",
  "cashEntries",
  "pauschalen",
  "employees",
  "vatReturns",
  "zmSubmissions",
  "postfachDocuments",
  "archive",
] as const;

export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

/** Was die Steuerberatung lesen darf (docs/steuerberatung.md); alles andere fragt der Server für sie gar nicht erst */
const STEUERBERATUNG: readonly PaletteGroup[] = ["invoices", "documents", "bookings", "accounts"];

/** Gruppen, die einen Betrag vergleichen */
const MIT_BETRAG: readonly PaletteGroup[] = ["invoices", "quotes", "documents", "bankTransactions", "bookings", "cashEntries", "pauschalen", "archive"];

/** Gruppen, die ein Datum vergleichen */
const MIT_DATUM: readonly PaletteGroup[] = [
  "invoices",
  "quotes",
  "documents",
  "bankTransactions",
  "bookings",
  "serviceEntries",
  "cashEntries",
  "pauschalen",
  "archive",
];

/**
 * Welche Gruppen eine Eingabe abfragt (#617, Entscheidung zu #1038): ein Datum nur die Gruppen mit Datum, ein Betrag mit
 * Cent oder Eurozeichen („1.190,00“, „19.99“, „89 €“) nur die mit Betrag. Eine reine Ziffernfolge bleibt in allen Gruppen,
 * denn sie kann auch Nummer, Personalnummer, Konto oder IBAN-Ende sein.
 */
export function paletteGroups(rawQuery: string, role: Rolle): PaletteGroup[] {
  const query = rawQuery.trim();
  const erlaubt = role === "inhaber" ? PALETTE_GROUPS : role === "steuerberatung" ? STEUERBERATUNG : [];
  if (query.length < 2) return [];
  if (parseDateSearch(query) !== null) return erlaubt.filter((g) => MIT_DATUM.includes(g));
  if (parseEuroSearchRange(query) !== null && /[,€]|\.\d{1,2}$/.test(query)) return erlaubt.filter((g) => MIT_BETRAG.includes(g));
  return [...erlaubt];
}

/** Führt Aufgaben mit höchstens `n` gleichzeitig aus, damit eine Eingabe nicht alle Verbindungen des Pools belegt */
export async function mitHoechstens<T>(n: number, aufgaben: (() => Promise<T>)[]): Promise<T[]> {
  const ergebnisse: T[] = new Array(aufgaben.length);
  let naechste = 0;
  async function arbeiter() {
    while (naechste < aufgaben.length) {
      const i = naechste++;
      ergebnisse[i] = await aufgaben[i]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, aufgaben.length) }, arbeiter));
  return ergebnisse;
}
