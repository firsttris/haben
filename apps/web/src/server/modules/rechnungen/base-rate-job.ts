import { baseRateRefreshDue, lastBaseRateChange } from "@haben/core";
import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { fetchBaseRate } from "./base-rate.ts";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Für den Scheduler, nur mit eingeschaltetem automatischem Abruf: Nach dem 1. Januar und 1. Juli höchstens einmal am Tag
 * fragen, bis die Bundesbank den Satz des neuen Halbjahrs meldet; dann Satz und Halbjahr speichern. Danach bis zum
 * nächsten Stichtag kein Abruf, denn der Satz ändert sich nur zu diesen Terminen (§ 247 Abs. 1 Satz 2 BGB).
 * null, wenn nichts zu tun war.
 */
export async function runDueBaseRate(today: string, now = Date.now(), fetchImpl: typeof fetch = fetch) {
  const state = globalThis as { __habenBasiszinsAbgerufen?: number };
  if (state.__habenBasiszinsAbgerufen && now - state.__habenBasiszinsAbgerufen < DAY) return null;
  const company = await loadCompany();
  if (!baseRateRefreshDue(company.dunning, today)) return null;
  state.__habenBasiszinsAbgerufen = now;
  const rate = await fetchBaseRate(today, fetchImpl);
  if (!rate.current) return { updated: false as const, month: rate.month };
  const previous = company.dunning.baseRate;
  await withActor("system:basiszins", async (tx) => {
    // Erneut lesen: zwischen Abruf und Speichern kann jemand die Einstellungen gespeichert haben
    const current = await loadCompany(tx);
    if (!current.dunning.autoBaseRate) return;
    await tx
      .update(schema.company)
      .set({ dunning: { ...current.dunning, baseRate: rate.basisPoints, baseRateSince: lastBaseRateChange(today) } })
      .where(eq(schema.company.id, 1));
  });
  return { updated: true as const, month: rate.month, basisPoints: rate.basisPoints, changed: previous !== rate.basisPoints };
}
