/*
 * Nimmt die Werte aus Haben entgegen und legt sie in chrome.storage.session ab: nur im Speicher, weg nach dem
 * Schließen des Browsers. Die Inhaltsskripte dürfen den Sitzungsspeicher erst lesen, wenn er dafür freigegeben ist.
 */
import { type MeinElsterWerte, pruefeWerte } from "./fill.ts";

const NAMEN: Record<string, string> = {
  ustvaeru: "Umsatzsteuer-Voranmeldung",
  ust: "Umsatzsteuererklärung",
  euer: "Anlage EÜR",
  est: "Einkommensteuererklärung",
};

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const status = element<HTMLParagraphElement>("status");
const eingabe = element<HTMLTextAreaElement>("werte");

function zeige(text: string, fehler = false): void {
  status.textContent = text;
  status.className = fehler ? "fehler" : "";
}

async function zeigeGeladen(): Promise<void> {
  const { werte } = (await chrome.storage.session.get("werte")) as { werte?: MeinElsterWerte };
  if (!werte) return zeige("Keine Werte geladen.");
  const zeitraum = werte.zeitraum ? `, Zeitraum ${werte.zeitraum}` : "";
  zeige(`Geladen: ${NAMEN[werte.formular] ?? werte.formular} ${werte.jahr}${zeitraum}, ${werte.felder.length} Werte. In Mein ELSTER das Formular öffnen.`);
}

element<HTMLButtonElement>("speichern").addEventListener("click", async () => {
  let werte: unknown;
  try {
    werte = JSON.parse(eingabe.value);
  } catch {
    return zeige("Das ist kein gültiger Text aus Haben. Bitte neu kopieren und einfügen.", true);
  }
  const fehler = pruefeWerte(werte);
  if (fehler) return zeige(fehler, true);
  await chrome.storage.session.set({ werte, gefunden: {} });
  eingabe.value = "";
  await zeigeGeladen();
});

element<HTMLButtonElement>("loeschen").addEventListener("click", async () => {
  await chrome.storage.session.clear();
  await zeigeGeladen();
});

void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).then(zeigeGeladen);
