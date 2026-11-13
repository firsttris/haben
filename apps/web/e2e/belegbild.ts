import { readFileSync } from "node:fs";
import type { Browser } from "@playwright/test";
import { day } from "./daten.ts";

/**
 * Erfundene Mobilfunkrechnung als JPEG, gerendert im Browser: ein A4-Blatt mit Briefkopf, Anschrift im Fenster,
 * Rechnungsangaben, Positionen und Fußzeile, wie eine Rechnung, die per Post oder als Scan kommt. Die Bilder für
 * README und Doku zeigen sie in der Belegansicht. Die Beträge passen zu den Tests: 38,57 € netto, 7,33 €
 * Umsatzsteuer, 45,90 € brutto, Rechnungsnummer MF-0815 vom day(-9). Die Schrift kommt aus packages/einvoice,
 * damit das Bild auf jedem Rechner gleich aussieht.
 */

const schrift = (datei: string) => readFileSync(new URL(`../../../packages/einvoice/fonts/${datei}`, import.meta.url)).toString("base64");

let schriften: string | undefined;
function fontFaces(): string {
  schriften ??= [
    ["SourceSans3-Regular.ttf", 400],
    ["SourceSans3-Semibold.ttf", 600],
  ]
    .map(([datei, gewicht]) => `@font-face { font-family: Beleg; font-weight: ${gewicht}; src: url(data:font/ttf;base64,${schrift(String(datei))}); }`)
    .join("\n");
  return schriften;
}

const deutsch = (iso: string) => iso.split("-").reverse().join(".");

/** Der Monat vor dem Rechnungsdatum, wie ihn Mobilfunkanbieter abrechnen */
function abrechnungsmonat(iso: string): { name: string; von: string; bis: string } {
  const [jahr, monat] = iso.split("-").map(Number) as [number, number];
  const erster = new Date(Date.UTC(jahr, monat - 2, 1));
  const letzter = new Date(Date.UTC(jahr, monat - 1, 0));
  const name = erster.toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
  const iso10 = (d: Date) => d.toISOString().slice(0, 10);
  return { name, von: deutsch(iso10(erster)), bis: deutsch(iso10(letzter)) };
}

function html(title: string): string {
  const datum = day(-9);
  const monat = abrechnungsmonat(datum);
  return `<!doctype html><html lang="de"><head><style>
    ${fontFaces()}
    * { box-sizing: border-box; margin: 0; }
    body { width: 794px; height: 1123px; padding: 48px 64px 0 76px; font: 400 12.5px/1.45 Beleg, sans-serif; color: #1d2433; background: #fff; position: relative; }
    .kopf { display: flex; justify-content: space-between; align-items: flex-start; }
    .marke { display: flex; align-items: center; gap: 12px; }
    .logo { width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #e2007a, #7a1fa2); position: relative; }
    .logo::before, .logo::after { content: ""; position: absolute; border: 3px solid #fff; border-color: #fff transparent transparent transparent; border-radius: 50%; left: 50%; transform: translateX(-50%); }
    .logo::before { width: 26px; height: 26px; top: 12px; }
    .logo::after { width: 14px; height: 14px; top: 19px; }
    .firma { font-weight: 600; font-size: 21px; letter-spacing: -0.2px; }
    .firma small { display: block; font-weight: 400; font-size: 11px; color: #6b7385; letter-spacing: 0.4px; }
    .kontakt { text-align: right; font-size: 11px; color: #4a5263; }
    .absender { margin-top: 60px; font-size: 9.5px; color: #6b7385; text-decoration: underline; }
    .empfaenger { margin-top: 6px; font-size: 13px; line-height: 1.5; }
    .anschrift-und-daten { display: flex; justify-content: space-between; }
    .daten { margin-top: 56px; font-size: 11.5px; border-collapse: collapse; }
    .daten td { padding: 1px 0; }
    .daten td:first-child { color: #6b7385; padding-right: 18px; }
    .daten td:last-child { text-align: right; }
    h1 { margin-top: 58px; font-size: 22px; font-weight: 600; }
    .einleitung { margin-top: 8px; color: #353d4d; }
    table.posten { width: 100%; margin-top: 22px; border-collapse: collapse; }
    .posten th { text-align: left; font-weight: 600; font-size: 11px; color: #6b7385; border-bottom: 1.5px solid #1d2433; padding: 6px 0; }
    .posten td { padding: 9px 0; border-bottom: 1px solid #e3e6ec; vertical-align: top; }
    .posten td small { display: block; color: #6b7385; font-size: 11px; }
    .posten .betrag { text-align: right; white-space: nowrap; }
    .summe { width: 46%; margin: 14px 0 0 auto; border-collapse: collapse; }
    .summe td { padding: 4px 0; }
    .summe td:last-child { text-align: right; }
    .summe tr.gesamt td { font-weight: 600; font-size: 14px; border-top: 1.5px solid #1d2433; padding-top: 8px; }
    .zahlung { margin-top: 34px; padding: 12px 16px; background: #f5f6f9; border-left: 3px solid #b3127f; color: #353d4d; }
    .gruss { margin-top: 26px; color: #353d4d; }
    footer { position: absolute; left: 76px; right: 64px; bottom: 40px; display: flex; justify-content: space-between; gap: 24px; padding-top: 10px; border-top: 1px solid #d6dae2; font-size: 9.5px; line-height: 1.5; color: #6b7385; }
  </style></head><body>
    <div class="kopf">
      <div class="marke"><div class="logo"></div><div class="firma">${title}<small>MOBILFUNK FÜR GESCHÄFTSKUNDEN</small></div></div>
      <div class="kontakt">Geschäftskundenservice<br>0800 412 33 00 (kostenfrei)<br>service@funknetz.example<br>www.funknetz.example</div>
    </div>
    <div class="anschrift-und-daten">
      <div>
        <p class="absender">${title} · Hafenallee 10 · 28217 Bremen</p>
        <p class="empfaenger">Mustermann IT<br>Max Mustermann<br>Musterstraße 12<br>93047 Regensburg</p>
      </div>
      <table class="daten">
        <tr><td>Rechnungsnummer</td><td>MF-0815</td></tr>
        <tr><td>Rechnungsdatum</td><td>${deutsch(datum)}</td></tr>
        <tr><td>Kundennummer</td><td>4711 2290</td></tr>
        <tr><td>Rufnummer</td><td>0151 2345 6789</td></tr>
        <tr><td>Abrechnungszeitraum</td><td>${monat.von} – ${monat.bis}</td></tr>
      </table>
    </div>
    <h1>Rechnung</h1>
    <p class="einleitung">Sehr geehrter Herr Mustermann,<br>für Ihren Mobilfunkvertrag berechnen wir Ihnen für ${monat.name}:</p>
    <table class="posten">
      <tr><th>Leistung</th><th class="betrag">Netto</th></tr>
      <tr><td>Tarif Business M<small>Monatlicher Grundpreis, ${monat.von} – ${monat.bis}</small></td><td class="betrag">29,40 €</td></tr>
      <tr><td>Datenoption 10 GB<small>Zusatzvolumen, monatlich</small></td><td class="betrag">8,32 €</td></tr>
      <tr><td>Verbindungen außerhalb des Inklusivvolumens<small>3 Verbindungen ins Ausland, siehe Einzelverbindungsnachweis</small></td><td class="betrag">0,85 €</td></tr>
    </table>
    <table class="summe">
      <tr><td>Summe netto</td><td>38,57 €</td></tr>
      <tr><td>Umsatzsteuer 19 %</td><td>7,33 €</td></tr>
      <tr class="gesamt"><td>Rechnungsbetrag</td><td>45,90 €</td></tr>
    </table>
    <p class="zahlung">Bitte überweisen Sie den Rechnungsbetrag innerhalb von 14 Tagen ohne Abzug unter Angabe der
      Rechnungsnummer MF-0815 auf das unten genannte Konto.</p>
    <p class="gruss">Vielen Dank, dass Sie mit ${title} telefonieren.<br>Ihr Geschäftskundenteam</p>
    <footer>
      <div>${title}<br>Hafenallee 10, 28217 Bremen<br>Geschäftsführung: Jana Beispiel</div>
      <div>Amtsgericht Bremen, HRB 31415<br>USt-IdNr. DE298765432<br>Steuernummer 60 145 12345</div>
      <div>Postbank<br>IBAN DE02 1001 0010 0006 8201 01<br>BIC PBNKDEFFXXX</div>
    </footer>
  </body></html>`;
}

/** Erfundene Mobilfunkrechnung als JPEG im Format A4 */
export async function receiptJpeg(browser: Browser, title = "Funknetz Mobil GmbH"): Promise<Buffer> {
  const p = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  await p.setContent(html(title));
  await p.evaluate(() => document.fonts.ready);
  const jpeg = await p.screenshot({ type: "jpeg", quality: 85 });
  await p.close();
  return jpeg;
}
