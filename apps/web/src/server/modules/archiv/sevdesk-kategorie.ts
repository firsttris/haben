import type { ExpenseCategory } from "@haben/core";
import { sevAccountCategory, type SevAccountCategory, type SevAccountNumbers } from "@haben/import";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index.ts";
import type { LegacyCategoryRow } from "../../db/schema.ts";

/*
 * Kategorie je Position eines Belegs aus sevDesk (#472), zur Laufzeit aus dem gespeicherten Kontostamm
 * (sevdesk_accounting_types, abgerufen in sevdesk-kontoart-abruf.ts); die Archivkopie bleibt unverändert. Die Positionen
 * stehen in `raw.positions` in derselben Reihenfolge wie `categories` (mapSevVoucher). Der Kontostamm ist klein (ein Eintrag
 * je Konto und Stand): Er wird einmal je Abfrage gelesen, nicht je Beleg in SQL nachgeschlagen, damit Abgleich und
 * Zeitraumabfrage keine weitere korrelierte Unterabfrage auf eine Tabelle bekommen.
 */

/** Positionen eines Belegs als Mengenfunktion für `from`; ohne Positionen leer */
export function sevdeskPositions(alias: string): SQL {
  return sql.raw(`jsonb_array_elements(case when jsonb_typeof(${alias}.raw->'positions') = 'array' then ${alias}.raw->'positions' else '[]'::jsonb end)`);
}

/** Konto einer Position (jsonb); mit `accountDatev` (Buchhaltungsversion 2.0) zählt jenes, wie in mapSevVoucher */
export function sevdeskPositionAccount(position: string): SQL<string | null> {
  return sql.raw(`case when coalesce(${position}->'accountDatev'->>'id', '') = '' then ${position}->'accountingType'->>'id' end`) as SQL<string | null>;
}

/** Konto je Position eines Belegs aus sevDesk, in der Reihenfolge der Positionen; andere Quellen null */
export function sevdeskPositionAccounts(alias: string): SQL<(string | null)[] | null> {
  return sql<(string | null)[] | null>`(case when ${sql.raw(alias)}.source = 'sevdesk' then
    (select coalesce(jsonb_agg(${sevdeskPositionAccount("p.value")} order by p.ordinality), '[]'::jsonb)
      from ${sevdeskPositions(alias)} with ordinality p) end)`;
}

/** Wie sevdeskPositionAccounts, aus der gespeicherten Antwort eines einzelnen Belegs */
export function sevdeskPositionAccountsOf(raw: unknown): (string | null)[] | null {
  const positions = (raw as { positions?: unknown } | null)?.positions;
  if (!Array.isArray(positions)) return null;
  const id = (ref: unknown) => {
    const value = (ref as { id?: unknown } | null)?.id;
    return value == null || value === "" ? null : String(value);
  };
  return positions.map((p: { accountDatev?: unknown; accountingType?: unknown }) => (id(p?.accountDatev) ? null : id(p?.accountingType)));
}

export type SevdeskAccountCategories = Map<string, SevAccountCategory | null>;

/** Kategorie je Konto aus allen gespeicherten Antworten; ein Konto ohne Antwort fehlt in der Map */
export async function loadSevdeskAccountCategories(): Promise<SevdeskAccountCategories> {
  const rows = await db.execute<{ id: string; answers: SevAccountNumbers[] }>(sql`
    select accounting_type_id as id, jsonb_agg(jsonb_build_object('skr03', raw->>'skr03', 'skr04', raw->>'skr04')) as answers
    from sevdesk_accounting_types group by accounting_type_id`);
  return new Map([...rows].map((r) => [r.id, sevAccountCategory(r.answers)]));
}

export const unknownAccountName = (account: string) => `Sonstiges (Buchungskonto ${account} nicht erkannt)`;

/**
 * Kategorien eines Belegs mit dem Namen aus dem Kontostamm: Kategorie von Haben, Name des DATEV-Kontos oder „Erlöse“.
 * Ein Konto ohne Antwort oder ohne erkannte Nummer bleibt „Sonstiges“ und sagt es. Positionen ohne Konto und Belege, deren
 * Positionen nicht zu den Kategorien passen, bleiben wie gespeichert.
 */
export function sevdeskCategories(categories: LegacyCategoryRow[], accounts: (string | null)[] | null, known: SevdeskAccountCategories): LegacyCategoryRow[] {
  if (!accounts || accounts.length !== categories.length) return categories;
  return categories.map((c, i) => {
    const account = accounts[i];
    if (!account) return c;
    return { ...c, name: known.get(account)?.name ?? unknownAccountName(account) };
  });
}

/**
 * Ausgabenkategorie für einen übernommenen Beleg (eine Kategorie je Beleg): die der Position mit dem größten Nettobetrag,
 * wenn ihr Konto eine Ausgabenkategorie ergibt; sonst null, dann gilt die bisherige Zuordnung („Sonstiges“).
 */
export function sevdeskExpenseCategory(
  categories: LegacyCategoryRow[],
  accounts: (string | null)[] | null,
  known: SevdeskAccountCategories,
): ExpenseCategory | null {
  if (!accounts || accounts.length !== categories.length || categories.length === 0) return null;
  const largest = categories.reduce((best, c, i) => (Math.abs(c.net) > Math.abs(categories[best]!.net) ? i : best), 0);
  const account = accounts[largest];
  const category = account ? known.get(account) : null;
  return category?.art === "ausgabe" ? category.kategorie : null;
}
