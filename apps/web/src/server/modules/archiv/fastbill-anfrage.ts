import { FastbillApiError, type FastbillClient } from "@haben/import";
import { fastbillPreviousCalls, latestFastbillImport } from "./fastbill.ts";
import { FastbillError, fastbillCredentials, newFastbillClient, noteFastbillCalls } from "./fastbill-zugang.ts";

/*
 * Abrufe aus FastBill, die in der Anfrage laufen statt im Hintergrund (Artikel, offene Zeiten): Sie zählen auf dieselbe
 * Stundengrenze wie der Abruf der Belege, in beide Richtungen (fastbillPreviousCalls, noteFastbillCalls). Ist sie
 * erreicht, brechen sie ab, statt bis zu einer Stunde in der Anfrage zu warten; ebenso, wenn FastBill wegen einer Störung
 * länger warten lässt. Während eines laufenden Abrufs der Belege läuft keiner.
 */

/** Längste Wartezeit in der Anfrage: Mindestabstand und kurze Wiederholungen ja, die Stundengrenze nein */
const MAX_WAIT_MS = 30_000;

/** limited: Der Client wartet wegen der Stundengrenze oder weil FastBill bremst (429), nicht wegen einer Störung (503 …) */
function waitBriefly(ms: number, limited: boolean, what: string): Promise<void> {
  if (ms > MAX_WAIT_MS) {
    const minutes = Math.ceil(ms / 60_000);
    const reason = limited ? "Die Stundengrenze deines FastBill-Tarifs ist erreicht." : "FastBill antwortet gerade nicht.";
    return Promise.reject(new FastbillError(`${reason} Hol die ${what} in ${minutes} Minuten.`));
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** what: was geholt wird, für die Meldungen („Artikel“, „Zeiten“) */
export async function withFastbillRequest<T>(what: string, run: (client: FastbillClient) => Promise<T>): Promise<T> {
  const login = await fastbillCredentials();
  if (!login) throw new FastbillError("Zuerst im Umzug aus FastBill Login-E-Mail und API-Schlüssel hinterlegen.");
  const last = await latestFastbillImport();
  if (last?.status === "laeuft") throw new FastbillError(`Gerade läuft ein Abruf aus FastBill. Hol die ${what}, wenn er fertig ist.`);
  const previous = await fastbillPreviousCalls();
  // Der Client meldet die Stundengrenze und 429 über onRateLimitWait, unmittelbar bevor er schläft
  let limited = false;
  const client = newFastbillClient({
    ...login,
    previousCalls: previous,
    onRateLimitWait: () => {
      limited = true;
    },
    sleep: (ms) => {
      const wait = waitBriefly(ms, limited, what);
      limited = false;
      return wait;
    },
  });
  try {
    return await run(client);
  } catch (error) {
    if (error instanceof FastbillApiError) throw new FastbillError(`FastBill: ${error.message}`, { cause: error });
    throw error;
  } finally {
    // recentCalls enthält die früheren Aufrufe der letzten Stunde vorn; gemerkt werden nur die eigenen
    const since = Date.now() - 3_600_000;
    noteFastbillCalls(client.recentCalls().slice(previous.filter((t) => t > since).length));
  }
}
