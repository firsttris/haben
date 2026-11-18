import { randomBytes } from "node:crypto";
import type { FintsAntwort, FintsWeiter } from "@haben/import";
import { BankError } from "./bank-error.ts";

/**
 * Laufende FinTS-Vorgänge zwischen zwei Anfragen des Browsers (#654): Verlangt die Bank eine TAN oder die Wahl des
 * TAN-Verfahrens, wartet der Dialog mit der Bank, bis die Person antwortet. Der Dialog lebt im Client von lib-fints
 * (samt PIN im Speicher) und lässt sich nicht speichern; er bleibt deshalb nur im Prozess, höchstens zehn Minuten und
 * nur für die Person, die ihn begonnen hat. Danach beginnt man neu.
 */

/** So lange wartet ein Vorgang; Banken lassen eine TAN meist fünf Minuten gelten */
const LEBENSDAUER_MS = 10 * 60 * 1000;

export interface FintsEingabe {
  tan?: string;
  verfahren?: number;
  medium?: string;
}

export type FintsSchritt =
  | { art: "fertig"; ok: boolean; meldung: string; hinweise: string[]; neu: number }
  | { art: "verfahren"; vorgang: string; verfahren: { id: number; name: string; medien: string[] }[] }
  | { art: "tan"; vorgang: string; text: string; entkoppelt: boolean; bild: string | null; hinweis: string | null };

interface Vorgang {
  actor: string;
  art: "tan" | "verfahren";
  bis: number;
  weiter: (eingabe: FintsEingabe) => Promise<FintsSchritt>;
}

const vorgaenge = new Map<string, Vorgang>();

function aufraeumen(jetzt: number) {
  for (const [id, v] of vorgaenge) if (v.bis <= jetzt) vorgaenge.delete(id);
}

/** Merkt sich die Fortsetzung und gibt die Kennung für den Browser zurück */
export function vorgangMerken(actor: string, art: Vorgang["art"], weiter: Vorgang["weiter"], jetzt = Date.now()): string {
  aufraeumen(jetzt);
  const id = randomBytes(18).toString("base64url");
  vorgaenge.set(id, { actor, art, bis: jetzt + LEBENSDAUER_MS, weiter });
  // Auch wenn niemand fortsetzt oder abbricht (Fenster geschlossen): Client und PIN gehen nach der Lebensdauer
  setTimeout(() => vorgaenge.delete(id), LEBENSDAUER_MS).unref();
  return id;
}

/** Setzt einen Vorgang fort; jede Kennung gilt einmal, ein weiterer Schritt bekommt eine neue */
export async function vorgangFortsetzen(actor: string, id: string, eingabe: FintsEingabe, jetzt = Date.now()): Promise<FintsSchritt> {
  aufraeumen(jetzt);
  const vorgang = vorgaenge.get(id);
  if (!vorgang || vorgang.actor !== actor) throw new BankError("Der Vorgang ist abgelaufen oder unbekannt. Bitte neu beginnen.");
  if (vorgang.art === "tan" && eingabe.verfahren !== undefined) throw new BankError("Hier fehlt die TAN, kein TAN-Verfahren.");
  if (vorgang.art === "verfahren" && eingabe.verfahren === undefined) throw new BankError("Bitte ein TAN-Verfahren wählen.");
  vorgaenge.delete(id);
  return vorgang.weiter(eingabe);
}

/** Bricht einen Vorgang ab, etwa wenn die Person das Formular schließt */
export function vorgangVerwerfen(actor: string, id: string): void {
  if (vorgaenge.get(id)?.actor === actor) vorgaenge.delete(id);
}

/**
 * Die Bank kennt die Registrierungsnummer nicht: 9078 „Dialog abgebrochen – FinTS-Produkt ist nicht registriert“ nach der
 * Liste „FinTS Rückmeldungscodes“ der DK (Stand 03.02.2026, fints.org › Spezifikation). 9952 „Das Kundenprodukt wird nicht
 * unterstützt“ steht nicht in der Liste; damit lehnte eine echte Bank beim ersten Test (firsttris/haben#1289) eine neue
 * Nummer ab, die sie noch nicht übernommen hatte. Die DK gibt neue Nummern etwa wöchentlich weiter, und die Banken
 * übernehmen sie nach Tagen bis Wochen (Hinweis der DK zur Registrierung, zitiert in firsttris/haben#654).
 */
const PRODUKT_UNBEKANNT = [9078, 9952];

/** Text einer Ablehnung, bei bekannten Codes mit Erklärung */
export function fintsAblehnung(antwort: { meldung: string; codes: number[] }): string {
  if (!antwort.codes.some((code) => PRODUKT_UNBEKANNT.includes(code))) return antwort.meldung;
  return `${antwort.meldung} Die Bank kennt die Registrierungsnummer aus FINTS_PRODUKT_ID nicht oder noch nicht. Stimmt die Nummer, hat die Bank sie wohl noch nicht übernommen: Das dauert nach der Registrierung Tage bis Wochen, bei jeder Bank verschieden.`;
}

/** Was nach einer Antwort der Bank geschieht; ausfall bei Netz- oder Protokollfehlern in einer Fortsetzung */
export interface FintsFolge<T> {
  weiter: (w: FintsWeiter) => Promise<FintsAntwort<T>>;
  fertig: (wert: T) => Promise<FintsSchritt>;
  abgelehnt: (meldung: string) => Promise<FintsSchritt>;
  ausfall: (error: unknown) => Promise<FintsSchritt>;
}

/**
 * Führt eine Antwort der Bank weiter: „ok“ geht an fertig, „abgelehnt“ an abgelehnt, „tan“ wird ein Schritt für den
 * Browser, dessen Fortsetzung die TAN (oder bei pushTAN nur die Bestätigung) an die Bank gibt. Steht die Freigabe in
 * der App noch aus, kommt dieselbe Anfrage mit einem Hinweis zurück.
 */
export async function mitTan<T>(actor: string, antwort: FintsAntwort<T>, folge: FintsFolge<T>, hinweis: string | null = null): Promise<FintsSchritt> {
  if (antwort.art === "ok") return folge.fertig(antwort.wert);
  if (antwort.art === "abgelehnt") return folge.abgelehnt(fintsAblehnung(antwort));
  const { anfrage } = antwort;
  const vorgang = vorgangMerken(actor, "tan", async ({ tan }) => {
    if (!anfrage.entkoppelt && !tan?.trim()) return mitTan(actor, antwort, folge, "Bitte die TAN eingeben.");
    let naechste: FintsAntwort<T>;
    try {
      naechste = await folge.weiter({ referenz: anfrage.referenz, tan: anfrage.entkoppelt ? undefined : tan?.trim() });
    } catch (error) {
      return folge.ausfall(error);
    }
    const ausstehend = naechste.art === "tan" && anfrage.entkoppelt ? "Noch nicht freigegeben. Bitte in der App der Bank bestätigen und dann weiter." : null;
    return mitTan(actor, naechste, folge, ausstehend);
  });
  return { art: "tan", vorgang, text: anfrage.text, entkoppelt: anfrage.entkoppelt, bild: anfrage.bild ?? null, hinweis };
}
