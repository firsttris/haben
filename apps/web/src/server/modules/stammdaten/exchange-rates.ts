import { bmfRatesUrl, CURRENCY_CODE, parseBmfRates, parseExchangeRate, type PublishedRate } from "@haben/core";
import { and, desc, eq, max, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Umsatzsteuer-Umrechnungskurse (§ 16 Abs. 6 UStG): das BMF gibt je Monat Durchschnittskurse bekannt, „1 EUR = x“.
 * Haben ruft sie aus dem Datenportal des BMF ab (CSV, Datenlizenz Deutschland – Namensnennung 2.0, Quelle: BMF) und
 * speichert sie je Währung und Monat. Belege und Rechnungen nehmen daraus den Kurs ihres Monats und speichern ihn selbst;
 * ein später geänderter Kurs ändert also nichts, was schon gebucht ist.
 */

export type ExchangeRate = typeof schema.exchangeRates.$inferSelect;

/** Kurs einer Währung in einem Monat (JJJJ-MM), oder null */
export async function rateForMonth(currency: string, month: string, q: Db | Tx = db): Promise<ExchangeRate | null> {
  if (currency === "EUR") return null;
  const [row] = await q
    .select()
    .from(schema.exchangeRates)
    .where(and(eq(schema.exchangeRates.currency, currency), eq(schema.exchangeRates.month, month)));
  return row ?? null;
}

/** Gespeicherte Kurse, neueste Monate zuerst */
export async function listExchangeRates(limit = 200): Promise<ExchangeRate[]> {
  return db.select().from(schema.exchangeRates).orderBy(desc(schema.exchangeRates.month), schema.exchangeRates.currency).limit(limit);
}

export const exchangeRateSchema = z.object({
  currency: z.string().trim().toUpperCase().regex(CURRENCY_CODE, "Währung als dreistelliger Code, z. B. USD").refine((c) => c !== "EUR", "Für Euro gibt es keinen Kurs"),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Monat als JJJJ-MM"),
  rate: z.string().transform((value, ctx) => {
    const rate = parseExchangeRate(value);
    if (!rate) ctx.addIssue({ code: "custom", message: "Kurs ungültig, z. B. 1,0812" });
    return rate ?? "";
  }),
});

/** Speichert Kurse; bestehende Kurse desselben Monats werden ersetzt. Gibt die Zahl neuer und geänderter Kurse zurück. */
export async function storeExchangeRates(actor: string, rates: PublishedRate[], source: "bmf" | "manuell"): Promise<{ added: number; changed: number }> {
  return withActor(actor, async (tx) => {
    let added = 0;
    let changed = 0;
    for (const r of rates) {
      const existing = await rateForMonth(r.currency, r.month, tx);
      if (!existing) {
        await tx.insert(schema.exchangeRates).values({ currency: r.currency, month: r.month, rate: r.rate, source });
        added++;
      } else if (parseExchangeRate(existing.rate) !== r.rate || existing.source !== source) {
        await tx
          .update(schema.exchangeRates)
          .set({ rate: r.rate, source, fetchedAt: new Date() })
          .where(and(eq(schema.exchangeRates.currency, r.currency), eq(schema.exchangeRates.month, r.month)));
        changed++;
      }
    }
    return { added, changed };
  });
}

export async function deleteExchangeRate(actor: string, currency: string, month: string): Promise<void> {
  await withActor(actor, (tx) =>
    tx.delete(schema.exchangeRates).where(and(eq(schema.exchangeRates.currency, currency), eq(schema.exchangeRates.month, month))),
  );
}

export class ExchangeRateFetchError extends Error {}

/** Die Dateien des BMF sind nicht immer UTF-8; ohne gültiges UTF-8 als Windows-1252 lesen */
function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Kurse eines Jahres vom BMF; fetchImpl für Tests */
export async function fetchBmfRates(year: number, fetchImpl: typeof fetch = fetch): Promise<PublishedRate[]> {
  let response: Response;
  try {
    response = await fetchImpl(bmfRatesUrl(year), { signal: AbortSignal.timeout(30_000), headers: { accept: "text/csv,*/*" } });
  } catch (error) {
    throw new ExchangeRateFetchError(`Die Kurse des BMF sind nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status === 404) return [];
  if (!response.ok) throw new ExchangeRateFetchError(`Die Kurse des BMF sind nicht abrufbar (HTTP ${response.status}).`);
  return parseBmfRates(decode(new Uint8Array(await response.arrayBuffer())), year);
}

/**
 * Ruft die Kurse des laufenden Jahres ab, im Januar auch die des Vorjahres (der Dezemberkurs erscheint erst im Januar),
 * und speichert sie. Von Hand eingetragene Kurse für Monate, die das BMF inzwischen veröffentlicht hat, werden durch den
 * amtlichen Kurs ersetzt.
 */
export async function refreshExchangeRates(actor: string, todayDate: string, fetchImpl: typeof fetch = fetch) {
  const year = Number(todayDate.slice(0, 4));
  const years = todayDate.slice(5, 7) === "01" ? [year - 1, year] : [year];
  const rates: PublishedRate[] = [];
  for (const y of years) rates.push(...(await fetchBmfRates(y, fetchImpl)));
  const result = await storeExchangeRates(actor, rates, "bmf");
  const latest = rates.map((r) => r.month).sort().at(-1) ?? null;
  return { ...result, fetched: rates.length, latest };
}

/** Wird Fremdwährung überhaupt genutzt? Ohne Fremdwährung ruft Haben nichts ab. */
async function usesForeignCurrency(): Promise<boolean> {
  const [row] = await db.execute<{ used: boolean }>(sql`
    select exists (select 1 from documents where currency <> 'EUR')
        or exists (select 1 from invoices where currency <> 'EUR')
        or exists (select 1 from exchange_rates) as used`);
  return Boolean(row?.used);
}

/** Vormonat von JJJJ-MM-TT als JJJJ-MM */
function previousMonth(todayDate: string): string {
  const [y, m] = [Number(todayDate.slice(0, 4)), Number(todayDate.slice(5, 7))];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Für den Scheduler: höchstens einmal am Tag, nur wenn Fremdwährung genutzt wird und die Kurse des Vormonats noch fehlen
 * (das BMF veröffentlicht sie am ersten Arbeitstag des Folgemonats). null, wenn nichts zu tun war.
 */
export async function runDueExchangeRates(todayDate: string, now = Date.now(), fetchImpl: typeof fetch = fetch) {
  const state = globalThis as { __habenKurseAbgerufen?: number };
  if (state.__habenKurseAbgerufen && now - state.__habenKurseAbgerufen < DAY) return null;
  if (!(await usesForeignCurrency())) return null;
  const [latest] = await db
    .select({ month: max(schema.exchangeRates.month) })
    .from(schema.exchangeRates)
    .where(ne(schema.exchangeRates.source, "manuell"));
  if (latest?.month && latest.month >= previousMonth(todayDate)) return null;
  state.__habenKurseAbgerufen = now;
  return refreshExchangeRates("system:kurse", todayDate, fetchImpl);
}
