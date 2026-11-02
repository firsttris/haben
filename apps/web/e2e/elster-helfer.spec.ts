import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

/**
 * Die Logik der Erweiterung apps/elster-helfer in einem echten Browser, gegen eine nachgebaute Formularseite von
 * Mein ELSTER. Die Feldnamen sind die, die Mein ELSTER im November 2026 für die Anlage EÜR 2025 verwendet.
 */

const FILL = fileURLToPath(new URL("../../elster-helfer/fill.js", import.meta.url));

const SEITE = `<!doctype html><html lang="de"><body><main>
  <label for="a">Umsatzsteuerpflichtige Betriebseinnahmen (Euro, Cent)</label>
  <input id="a" name="fields[eruEUERBEinUSt_StPflichtSumE6000401]">
  <label for="b">Vereinnahmte Umsatzsteuer (Euro, Cent)</label>
  <input id="b" name="fields[eruEUERBEinUStE6000601]" value="1,00">
  <label for="c">Steuerfreie Betriebseinnahmen</label>
  <input id="c" name="fields[eruEUERBEinUSt_StFreiSumE6000501]" value="10000,00">
  <label for="d">Bezeichnung</label>
  <input id="d" name="mzbs[GewinnBetriebUStEinnahmen].newItem.fields[eruEUERBEinUSt_StPflichtEinzE6000402]">
  <label for="e">Einkunftsart</label>
  <select id="e" name="fields[eruEUERAllgEinkunftsartE6000602]"><option value=""></option><option value="140">Selbständige Arbeit</option></select>
  <label for="f">Art des Kfz</label>
  <input type="radio" id="f1" name="fields[eruEUERKfzE6007327]" value="1"><input type="radio" id="f2" name="fields[eruEUERKfzE6007327]" value="2">
  <section>
    <label for="g1">Bezeichnung</label>
    <input id="g1" name="mzbs[GewinnBetriebUStVereinnahmt].newItem.fields[eruEUERBEinUSt_Vereinnahmt_UnentgeltlEinzE6000605]" data-eru-name="/EUER/BEin/USt_Vereinnahmt_Unentgeltl/Einz/E6000605">
    <label for="g2">Betrag (Euro, Cent)</label>
    <input id="g2" name="mzbs[GewinnBetriebUStVereinnahmt].newItem.fields[eruEUERBEinUSt_Vereinnahmt_UnentgeltlEinzE6000606]" data-eru-name="/EUER/BEin/USt_Vereinnahmt_Unentgeltl/Einz/E6000606">
    <button type="button" aria-label="Eintrag übernehmen">Übernehmen</button>
    <label for="g3">Vereinnahmte Umsatzsteuer sowie Umsatzsteuer auf unentgeltliche Wertabgaben</label>
    <input id="g3" name="fields[eruEUERBEinUSt_Vereinnahmt_UnentgeltlSumE6000601]" data-eru-name="/EUER/BEin/USt_Vereinnahmt_Unentgeltl/Sum/E6000601" disabled>
  </section>
  <section>
    <label for="h1">Bezeichnung</label>
    <input id="h1" name="mzbs[GewinnBetriebAnlage].newItem.fields[eruEUERBEinAnlagevermoegenEinzE6000802]" data-eru-name="/EUER/BEin/Anlagevermoegen/Einz/E6000802" value="schon begonnen">
    <label for="h2">Betrag (Euro, Cent)</label>
    <input id="h2" name="mzbs[GewinnBetriebAnlage].newItem.fields[eruEUERBEinAnlagevermoegenEinzE6000803]" data-eru-name="/EUER/BEin/Anlagevermoegen/Einz/E6000803">
    <button type="button" aria-label="Eintrag übernehmen">Übernehmen</button>
    <label for="h3">Veräußerung oder Entnahme von Anlagevermögen</label>
    <input id="h3" name="fields[eruEUERBEinAnlagevermoegenSumE6000801]" data-eru-name="/EUER/BEin/Anlagevermoegen/Sum/E6000801" disabled>
  </section>
  <input type="hidden" name="fields[eruVersteckt E6000999]" value="">
  <input name="fields[eruEUEROhneWertE6000000]">
</main></body></html>`;

const WERTE = {
  format: "haben-mein-elster",
  version: 1,
  formular: "euer",
  jahr: 2025,
  erstellt: "2026-11-02T10:00:00.000Z",
  felder: [
    { kennung: "E6000401", wert: "80000,00", pfad: ["E77", "BEin"], zeile: null },
    { kennung: "E6000601", wert: "15770,00", pfad: ["E77", "BEin"], zeile: null },
    { kennung: "E6000501", wert: "10000,00", pfad: ["E77", "BEin"], zeile: null },
    { kennung: "E6000402", wert: "Beratung", pfad: ["E77", "BEin", "Einz"], zeile: 1 },
    { kennung: "E6000602", wert: "140", pfad: ["E77", "Allg"], zeile: null },
    { kennung: "E6007327", wert: "2", pfad: ["E77", "AVEUER", "Kfz"], zeile: null },
    { kennung: "E6007202", wert: "82770,00", pfad: ["E77", "Gewinn"], zeile: null },
  ],
};

async function seite(page: Page) {
  await page.setContent(SEITE);
  await page.addScriptTag({ path: FILL });
}

test("trägt die Werte nach Feldkennung ein, überschreibt nichts und nennt Mehrfachzeilen", async ({ page }) => {
  await seite(page);
  const events: string[] = [];
  await page.exposeFunction("melde", (e: string) => events.push(e));
  await page.evaluate(() => document.getElementById("a")!.addEventListener("change", () => (window as unknown as { melde: (e: string) => void }).melde("change")));

  const ergebnis = await page.evaluate((werte) => (globalThis as unknown as { HabenElster: { ausfuellen: (d: Document, w: unknown) => unknown } }).HabenElster.ausfuellen(document, werte), WERTE);

  await expect(page.locator("#a")).toHaveValue("80000,00");
  await expect(page.locator("#b")).toHaveValue("1,00");
  await expect(page.locator("#e")).toHaveValue("140");
  await expect(page.locator("#f2")).toBeChecked();
  await expect(page.locator("#d")).toHaveValue("");
  expect(events).toContain("change");
  expect(ergebnis).toMatchObject({
    eingetragen: [
      { kennung: "E6000401", wert: "80000,00", label: "Umsatzsteuerpflichtige Betriebseinnahmen (Euro, Cent)" },
      { kennung: "E6000602", wert: "140" },
      { kennung: "E6007327", wert: "2" },
    ],
    gleich: [{ kennung: "E6000501" }],
    abweichend: [{ kennung: "E6000601", wert: "15770,00", vorhanden: "1,00" }],
    vonHand: [{ kennung: "E6000402", wert: "Beratung", zeile: 1, label: "Bezeichnung" }],
    nichtMoeglich: [],
  });
});

test("gesperrte Summe: füllt die freie Einzelposten-Zeile und markiert „Eintrag übernehmen“, klickt aber nicht", async ({ page }) => {
  await seite(page);
  let geklickt = 0;
  await page.exposeFunction("klick", () => (geklickt += 1));
  await page.evaluate(() => document.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => (window as unknown as { klick: () => void }).klick())));
  const ergebnis = await page.evaluate(
    (werte) => (globalThis as unknown as { HabenElster: { ausfuellen: (d: Document, w: unknown) => Record<string, unknown[]> } }).HabenElster.ausfuellen(document, werte),
    {
      ...WERTE,
      felder: [
        { kennung: "E6000601", wert: "15770,00", pfad: [], zeile: null },
        { kennung: "E6000801", wert: "500,00", pfad: [], zeile: null },
      ],
    },
  );
  await expect(page.locator("#g1")).toHaveValue("Laut Haben");
  await expect(page.locator("#g2")).toHaveValue("15770,00");
  await expect(page.locator("#g3")).toHaveValue("");
  expect(await page.locator('section:first-of-type button[aria-label="Eintrag übernehmen"]').evaluate((b) => (b as HTMLElement).style.outline)).not.toBe("");
  // Ist die Zeile schon angefangen, rührt die Erweiterung sie nicht an
  await expect(page.locator("#h2")).toHaveValue("");
  expect(ergebnis.uebernehmen).toEqual([expect.objectContaining({ kennung: "E6000601", wert: "15770,00", knopf: true })]);
  expect(ergebnis.nichtMoeglich).toEqual([expect.objectContaining({ kennung: "E6000801" })]);
  expect(geklickt).toBe(0);
});

test("Formular und Jahr aus dem Pfad, Prüfung der eingefügten Werte", async ({ page }) => {
  await seite(page);
  const r = await page.evaluate((werte) => {
    const h = (globalThis as unknown as { HabenElster: Record<string, (x: unknown) => unknown> }).HabenElster;
    return {
      pfad: h.formularAusPfad("/eportal/interpreter/eingabe/euer-2025/Startseite/VAnlageEUER/Betriebseinnahmen"),
      ust: h.formularAusPfad("/eportal/interpreter/eingabe/ust-2025/Startseite"),
      fremd: h.formularAusPfad("/eportal/meineformulare"),
      ok: h.pruefeWerte(werte),
      falsch: h.pruefeWerte({ format: "etwas" }),
      neuer: h.pruefeWerte({ ...(werte as object), version: 2 }),
    };
  }, WERTE);
  expect(r).toEqual({
    pfad: { formular: "euer", jahr: 2025 },
    ust: { formular: "ust", jahr: 2025 },
    fremd: null,
    ok: null,
    falsch: "Das sind keine Werte aus Haben („Werte für Mein ELSTER kopieren“).",
    neuer: "Version 2 kennt diese Erweiterung nicht. Bitte die Erweiterung aktualisieren.",
  });
});

test("Auswahl ohne passende Option wird gemeldet statt geraten", async ({ page }) => {
  await seite(page);
  const ergebnis = await page.evaluate(
    (werte) => (globalThis as unknown as { HabenElster: { ausfuellen: (d: Document, w: unknown) => { nichtMoeglich: unknown[] } } }).HabenElster.ausfuellen(document, werte),
    { ...WERTE, felder: [{ kennung: "E6000602", wert: "999", pfad: [], zeile: null }] },
  );
  expect(ergebnis.nichtMoeglich).toEqual([expect.objectContaining({ kennung: "E6000602", wert: "999" })]);
  await expect(page.locator("#e")).toHaveValue("");
});
