import { runDueBankSyncs } from "./bank-sync.ts";
import { elsterClient, elsterMode } from "./elster.ts";
import { env } from "./env.ts";
import { runDueInboxFetch } from "./inbox.ts";
import { runDueFristenMails } from "./mail.ts";
import { runDuePostfachFetch } from "./postfach.ts";
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
      console.log(`Wiederkehrende Rechnungen: ${result.created} angelegt, ${result.finalized} festgeschrieben, ${result.mailed} per E-Mail versandt`);
      for (const error of result.errors) console.warn(error);
    }
  } catch (error) {
    console.error("Wiederkehrende Rechnungen", error);
  }
  try {
    const result = await runDueBankSyncs();
    if (result.synced > 0) console.log(`Kontoabruf: ${result.synced} Verbindungen, ${result.added} neue Umsätze`);
    for (const error of result.errors) console.warn(error);
  } catch (error) {
    console.error("Kontoabruf", error);
  }
  try {
    if (elsterMode() === "eric") {
      const result = await runDuePostfachFetch(elsterClient(), env().ELSTER_HERSTELLER_ID);
      if (result) console.log(`ELSTER-Postfach: ${result.message}${result.bestaetigungFehler ? ` Bestätigung fehlgeschlagen: ${result.bestaetigungFehler}` : ""}`);
    }
  } catch (error) {
    console.error("ELSTER-Postfach", error);
  }
  try {
    const result = await runDueInboxFetch();
    if (result?.messages) console.log(`Belege per E-Mail: ${result.messages} Mails, ${result.documents} neue Belege`);
  } catch (error) {
    console.error("Belege per E-Mail", error);
  }
  try {
    const result = await runDueFristenMails(today());
    if (result?.sent) console.log(`Fristen-Erinnerung: ${result.sent} Frist(en) per E-Mail erinnert`);
  } catch (error) {
    console.error("Fristen-Erinnerung", error);
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
