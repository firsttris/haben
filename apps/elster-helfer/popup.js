/* global chrome, HabenElster */
/*
 * Nimmt die Werte aus Haben entgegen und legt sie in chrome.storage.session ab: nur im Speicher, weg nach dem
 * Schließen des Browsers. Die Inhaltsskripte dürfen den Sitzungsspeicher erst lesen, wenn er dafür freigegeben ist.
 */
const NAMEN = { ust: "Umsatzsteuererklärung", euer: "Anlage EÜR", est: "Einkommensteuererklärung" };
const status = document.getElementById("status");

function zeige(text, fehler = false) {
  status.textContent = text;
  status.className = fehler ? "fehler" : "";
}

async function zeigeGeladen() {
  const { werte } = await chrome.storage.session.get("werte");
  if (!werte) return zeige("Keine Werte geladen.");
  zeige(`Geladen: ${NAMEN[werte.formular] ?? werte.formular} ${werte.jahr}, ${werte.felder.length} Werte. In Mein ELSTER das Formular öffnen.`);
}

document.getElementById("speichern").addEventListener("click", async () => {
  let werte;
  try {
    werte = JSON.parse(document.getElementById("werte").value);
  } catch {
    return zeige("Das ist kein gültiger Text aus Haben. Bitte neu kopieren und einfügen.", true);
  }
  const fehler = HabenElster.pruefeWerte(werte);
  if (fehler) return zeige(fehler, true);
  await chrome.storage.session.set({ werte, gefunden: {} });
  document.getElementById("werte").value = "";
  await zeigeGeladen();
});

document.getElementById("loeschen").addEventListener("click", async () => {
  await chrome.storage.session.clear();
  await zeigeGeladen();
});

void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).then(zeigeGeladen);
