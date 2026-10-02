import { runDueRecurring } from "./recurring.ts";
import { today } from "./today.ts";

const HOUR = 60 * 60 * 1000;

/** Ein Lauf auf einmal; Fehler landen im Log, der nächste Lauf versucht es erneut */
let running = false;

export async function runScheduledJobs(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await runDueRecurring(today());
    if (result.created > 0 || result.errors.length > 0) {
      console.log(`Wiederkehrende Rechnungen: ${result.created} angelegt, ${result.finalized} festgeschrieben`);
      for (const error of result.errors) console.warn(error);
    }
  } catch (error) {
    console.error("Wiederkehrende Rechnungen", error);
  } finally {
    running = false;
  }
}

/**
 * Startet die Hintergrundjobs: kurz nach dem Start und danach stündlich. Mehrfaches Starten
 * (z. B. nach einem Neuladen im Entwicklungsserver) richtet nur einen Timer ein.
 */
export function startScheduler(): void {
  const state = globalThis as { __habenScheduler?: boolean };
  if (state.__habenScheduler || process.env.HABEN_SCHEDULER === "off") return;
  state.__habenScheduler = true;
  setTimeout(() => void runScheduledJobs(), 30_000).unref();
  setInterval(() => void runScheduledJobs(), HOUR).unref();
}
