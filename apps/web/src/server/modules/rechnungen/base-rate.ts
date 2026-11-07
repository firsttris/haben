import { BASE_RATE_URL, baseRateIsCurrent, parseBaseRateCsv, type PublishedBaseRate } from "@haben/core";
import { UserError } from "../../errors.ts";

export class BaseRateFetchError extends UserError {}

/**
 * Aktuellen Basiszinssatz bei der Bundesbank abfragen. Gespeichert wird nichts: der Wert landet im Feld der Einstellungen
 * und gilt erst, wenn die Firmendaten gespeichert werden. `current` ist false, wenn der Wert aus dem vorigen Halbjahr stammt.
 */
export async function fetchBaseRate(today: string, fetchImpl: typeof fetch = fetch): Promise<PublishedBaseRate & { current: boolean }> {
  let response: Response;
  try {
    response = await fetchImpl(BASE_RATE_URL, { signal: AbortSignal.timeout(20_000), headers: { accept: "text/csv" } });
  } catch (error) {
    throw new BaseRateFetchError(`Die Bundesbank ist nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new BaseRateFetchError(`Der Basiszinssatz ist bei der Bundesbank nicht abrufbar (HTTP ${response.status}).`);
  const rate = parseBaseRateCsv(await response.text());
  if (!rate) throw new BaseRateFetchError("Die Antwort der Bundesbank enthält keinen Basiszinssatz.");
  return { ...rate, current: baseRateIsCurrent(rate.month, today) };
}
