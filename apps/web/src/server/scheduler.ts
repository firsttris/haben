import { formatHundredths } from "@haben/core";
import { kleinunternehmerStand, runDueFileCheck, runDuePruefwertMail } from "./modules/auswertungen/index.ts";
import { runDueArchiveDeliveries } from "./modules/ablage/index.ts";
import { erklaerteAbweichungsZeilen } from "./modules/jahreserklaerung/index.ts";
import { runDueBankSyncs, runDueFintsSyncs, runExistingDuplicateCheck } from "./modules/bank/index.ts";
import { elsterClient, elsterMode } from "./modules/elster/index.ts";
import { env } from "./env.ts";
import { applyPublishedRates, runDueDauerbelege, runDueInboxFetch } from "./modules/belege/index.ts";
import { runDueExchangeRates } from "./modules/stammdaten/index.ts";
import { runDueFristenMails, runDuePostfachFetch } from "./modules/finanzamt/index.ts";
import { applyPublishedRatesToDrafts, runDueBaseRate, runDueRecurring } from "./modules/rechnungen/index.ts";
import { runDueEtsySyncs } from "./modules/etsy/index.ts";
import { runDuePayPalSyncs } from "./modules/paypal/index.ts";
import { runDueStripeSyncs } from "./modules/stripe/index.ts";
import { runDueStoreSyncs } from "./modules/stores/index.ts";
import { runDueUstIdPruefung } from "./modules/umsatzsteuer/index.ts";
import { today } from "./today.ts";

const HOUR = 60 * 60 * 1000;

/** Ein Lauf auf einmal; Fehler landen im Log, der nächste Lauf versucht es erneut */
let running = false;

async function runDueBankJobs() {
  try {
    const result = await runExistingDuplicateCheck();
    if (result) console.log(`Bankdubletten: Bestand geprüft, ${result.added} Verdachtspaare`);
  } catch (error) {
    console.error("Bankdublettenprüfung", error);
  }
  return runDueBankSyncs();
}

/** USt-IdNrn. aus Rechnungen beim BZSt bestätigen; höchstens einmal am Tag (runDueUstIdPruefung) */
async function ustIdPruefung() {
  try {
    const result = await runDueUstIdPruefung();
    if (result?.gefragt) console.log(`USt-IdNrn. beim BZSt: ${result.gefragt} von ${result.offen} angefragt`);
    if (result?.ausfall) console.warn(`USt-IdNrn. beim BZSt: abgebrochen, ${result.ausfall}`);
  } catch (error) {
    console.error("USt-IdNrn. beim BZSt", error);
  }
}

/** Die Bestätigung vor der Erinnerung, damit eine ungültige Nummer gleich in der Mail steht */
async function ustIdPruefungUndErinnerung() {
  await ustIdPruefung();
  return runDueFristenMails(today());
}

export async function runScheduledJobs(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await runDueRecurring(today(), kleinunternehmerStand);
    if (result.created > 0 || result.errors.length > 0) {
      console.log(`Wiederkehrende Rechnungen: ${result.created} angelegt, ${result.finalized} festgeschrieben, ${result.mailed} per E-Mail versandt`);
      for (const error of result.errors) console.warn(error);
    }
  } catch (error) {
    console.error("Wiederkehrende Rechnungen", error);
  }
  try {
    // Nach den wiederkehrenden Rechnungen, damit deren neue gleich mitgehen
    const result = await runDueArchiveDeliveries();
    if (result && (result.uebertragen > 0 || result.fehler > 0))
      console.log(`Ablage im Archiv: ${result.uebertragen} Rechnungen übertragen, ${result.fehler} fehlgeschlagen`);
  } catch (error) {
    console.error("Ablage im Archiv", error);
  }
  try {
    const result = await runDueDauerbelege(today());
    if (result.created > 0 || result.errors.length > 0) console.log(`Dauerbelege: ${result.created} Belege zu prüfen angelegt`);
    for (const error of result.errors) console.warn(error);
  } catch (error) {
    console.error("Dauerbelege", error);
  }
  try {
    const result = await runDueBankJobs();
    if (result.synced > 0) console.log(`Kontoabruf: ${result.synced} Verbindungen, ${result.added} neue Umsätze`);
    for (const error of result.errors) console.warn(error);
  } catch (error) {
    console.error("Kontoabruf", error);
  }
  try {
    const result = await runDueFintsSyncs();
    if (result.synced > 0) console.log(`FinTS-Abruf: ${result.synced} Verbindungen, ${result.added} neue Umsätze`);
    for (const error of result.errors) console.warn(error);
  } catch (error) {
    console.error("FinTS-Abruf", error);
  }
  try {
    const result = await runDueStoreSyncs();
    if (result.added > 0) console.log(`Store-Finanzberichte: ${result.synced} Stores, ${result.added} neue Berichte im Archiv`);
    for (const error of result.errors) console.warn(error);
  } catch (error) {
    console.error("Store-Finanzberichte", error);
  }
  try {
    const result = await runDueEtsySyncs();
    if (result.added > 0) console.log(`Etsy Payments: ${result.added} neue Umsätze aus dem Zahlungsverlauf`);
    for (const error of result.errors) console.warn(error);
  } catch (error) {
    console.error("Etsy Payments", error);
  }
  try {
    const result = await runDuePayPalSyncs();
    if (result.added > 0) console.log(`PayPal: ${result.added} neue Umsätze aus der Transaction Search`);
    for (const message of result.messages) console.warn(`PayPal: ${message}`);
    for (const error of result.errors) console.warn(error);
  } catch (error) {
    console.error("PayPal", error);
  }
  try {
    const result = await runDueStripeSyncs();
    if (result.added > 0) console.log(`Stripe: ${result.added} neue Umsätze aus den Balance Transactions`);
    for (const message of result.messages) console.warn(`Stripe: ${message}`);
    for (const error of result.errors) console.warn(error);
  } catch (error) {
    console.error("Stripe", error);
  }
  try {
    if (elsterMode() === "eric") {
      const result = await runDuePostfachFetch(elsterClient(), env().ELSTER_HERSTELLER_ID);
      if (result)
        console.log(`ELSTER-Postfach: ${result.message}${result.bestaetigungFehler ? ` Bestätigung fehlgeschlagen: ${result.bestaetigungFehler}` : ""}`);
    }
  } catch (error) {
    console.error("ELSTER-Postfach", error);
  }
  try {
    const result = await runDueExchangeRates(today());
    if (result) {
      const applied = await applyPublishedRates("system:kurse");
      const drafts = await applyPublishedRatesToDrafts("system:kurse");
      console.log(
        `Umrechnungskurse: ${result.added} neu, ${result.changed} geändert (bis ${result.latest ?? "–"}), ${applied} Belege und ${drafts} Rechnungsentwürfe umgerechnet`,
      );
    }
  } catch (error) {
    console.error("Umrechnungskurse", error);
  }
  try {
    const result = await runDueBaseRate(today());
    if (result?.updated)
      console.log(
        `Basiszinssatz: ${formatHundredths(result.basisPoints)} % (Bundesbank, Stand ${result.month})${result.changed ? ", geändert" : ", unverändert"}`,
      );
    else if (result) console.log(`Basiszinssatz: Bundesbank meldet noch Stand ${result.month}, neuer Versuch morgen`);
  } catch (error) {
    console.error("Basiszinssatz", error);
  }
  try {
    const result = await runDueInboxFetch();
    if (result?.messages) console.log(`Belege per E-Mail: ${result.messages} Mails, ${result.documents} neue Belege`);
  } catch (error) {
    console.error("Belege per E-Mail", error);
  }
  try {
    const result = await ustIdPruefungUndErinnerung();
    if (result?.sent) console.log(`Fristen-Erinnerung: ${result.sent} Frist(en) per E-Mail erinnert`);
  } catch (error) {
    console.error("Fristen-Erinnerung", error);
  } finally {
    running = false;
  }
  void runFileCheckAndPruefwertMail();
}

/** Eine Vollprüfung samt Mail auf einmal, unabhängig von `running` */
let fileCheckRunning = false;

/**
 * Die Vollprüfung liest alle Dateien und kann bei großen Beständen oder auf einem NAS länger als eine Stunde dauern.
 * Sie läuft deshalb neben den übrigen Jobs, damit Kontoabruf und Postfach des nächsten Laufs nicht auf sie warten. Die Prüfwert-Mail folgt ihr, damit sie den Stand dieses Tages nennt.
 */
async function runFileCheckAndPruefwertMail(): Promise<void> {
  if (fileCheckRunning) return;
  fileCheckRunning = true;
  try {
    try {
      const result = await runDueFileCheck();
      if (result?.problemCount) console.warn(`Vollprüfung der Dateien: ${result.problemCount} von ${result.files} fehlen oder sind verändert`);
    } catch (error) {
      console.error("Vollprüfung der Dateien", error);
    }
    try {
      // Übermittelte Jahreserklärungen gegen das Journal: jahreserklaerung steht über auswertungen (erklaert-pruefen.ts)
      const result = await runDuePruefwertMail(undefined, erklaerteAbweichungsZeilen);
      if (result)
        console.log(
          `Prüfwert des Audit-Logs (Nr. ${result.seq}) per E-Mail gesendet, ${result.problems} Befunde${result.fileProblems ? `, ${result.fileProblems} Dateien fehlen oder sind verändert` : ""}${result.rewritten ? ", Prüfwert der letzten Mail passt nicht mehr" : ""}`,
        );
    } catch (error) {
      console.error("Prüfwert-Mail", error);
    }
  } finally {
    fileCheckRunning = false;
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
