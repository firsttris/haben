import { SevdeskApiError, sevTaxSetFields, type SevdeskClient, type SevTaxSet } from "@haben/import";
import type { LegacyVatFields } from "@haben/core";
import { desc, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { progressMessage } from "./lexoffice.ts";

/*
 * Eigene Steuerarten aus sevDesk (GET /TaxSet, #472): je Abruf einmal unverändert gespeichert. Ein Beleg mit taxType
 * custom verweist per taxSet darauf; der Abgleich der Umsatzsteuer nimmt daraus die Kennzahlen der Voranmeldung.
 */

export async function importSevdeskTaxSets(actor: string, importId: string, client: SevdeskClient, progress: LexofficeImportProgress, signal: AbortSignal) {
  const raw: SevTaxSet[] = [];
  try {
    for await (const taxSet of client.taxSets()) raw.push(taxSet);
  } catch (error) {
    if (error instanceof SevdeskApiError && (error.status === 401 || error.status === 403)) throw error;
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    // Ohne Steuerarten stehen Belege mit eigener Steuerart im Abgleich unter „Andere Sätze“; der übrige Abruf läuft weiter
    progress.failed.push({ lexofficeId: "taxset", number: "Steuerarten", message: progressMessage(error) });
    return;
  }
  await withActor(actor, (tx) =>
    tx
      .insert(schema.sevdeskTaxSets)
      .values({ importId, raw: raw as Record<string, unknown>[] })
      .onConflictDoNothing({ target: schema.sevdeskTaxSets.importId }),
  );
}

/** Kennzahlen je Steuerart (sevDesk-ID) aus dem jüngsten Abruf; leer, wenn nie abgerufen */
export async function legacyTaxSetFields(): Promise<Map<string, LegacyVatFields>> {
  const [latest] = await db.select({ raw: schema.sevdeskTaxSets.raw }).from(schema.sevdeskTaxSets).orderBy(desc(schema.sevdeskTaxSets.createdAt)).limit(1);
  const result = new Map<string, LegacyVatFields>();
  for (const raw of latest?.raw ?? []) {
    const fields = sevTaxSetFields(raw as SevTaxSet);
    if (fields) result.set(fields.id, { rate: fields.rate, net: fields.net, tax: fields.tax });
  }
  return result;
}

/** sevDesk-ID der eigenen Steuerart eines Belegs (taxType custom ohne Steuerregel), sonst null */
export function customTaxSetId(t: string) {
  return sql<string | null>`${sql.raw(`case when ${t}.source = 'sevdesk' and coalesce(${t}.raw->'taxRule'->>'id', '') = '' and ${t}.raw->>'taxType' = 'custom'
    then ${t}.raw->'taxSet'->>'id' end`)}`;
}

/**
 * Ausgaben mit Steuerregel aus Update 2.0 (https://api.sevdesk.de/openapi.yaml, „VAT rules … (Expense)“), Kennzahlen
 * nach dem Vordruck USt 1 A 2026, Steuer 19 % auf das Netto wie sevDesk („0% (19%)“): 12 „Reverse Charge gem. §13b Abs. 2 UStG
 * mit Vorsteuerabzug“ Kz 84, 85 und 67; 14 „Reverse Charge gem. §13b Abs. 1 EU Umsätze“ Kz 46, 47 und 67 (Vordruck
 * USt 1 A 2026). Offen: 8 (innergemeinschaftlicher Erwerb, Satz je Position) und 13 (ohne Vorsteuerabzug, Absatz unklar).
 */
const RULE_FIELDS: Record<string, LegacyVatFields> = {
  "sevdesk:taxRule12": { rate: 1900, net: "84", tax: ["85", "67"] },
  "sevdesk:taxRule14": { rate: 1900, net: "46", tax: ["47", "67"] },
};

/** Kennzahlen der eigenen Steuerart: undefined ohne eigene Steuerart, null, wenn sie nicht abgerufen ist */
export function vatFieldsOf(taxSetId: string | null, taxSets: Map<string, LegacyVatFields>, taxType?: string | null): LegacyVatFields | null | undefined {
  if (taxSetId === null) return (taxType && RULE_FIELDS[taxType]) || undefined;
  return taxSets.get(taxSetId) ?? null;
}
