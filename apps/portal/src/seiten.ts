import type { Firma } from "@haben/core";

/*
 * Die Seiten des Portals, auf dem Server als HTML gerendert: kein Skript, damit die Content Security Policy nur
 * 'self' für das Stylesheet braucht. Jeder Text aus der Konfiguration oder der Anfrage geht durch `html`.
 */

/** Ab so vielen Firmen steht über der Liste ein Suchfeld, wie im FirmaWechsler von Haben */
export const SUCHE_AB = 20;

const ZEICHEN: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const html = (text: string) => text.replace(/[&<>"']/g, (z) => ZEICHEN[z]!);

function rahmen(titel: string, inhalt: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${html(titel)} · Haben</title>
<link rel="stylesheet" href="/stil.css">
</head>
<body>
<main class="portal">
<header class="marke"><span class="zeichen" aria-hidden="true">H</span><span class="marke-text">Haben</span></header>
${inhalt}
</main>
</body>
</html>`;
}

export function anmeldeSeite(anbieter: string, fehler?: string): string {
  const meldung = fehler ? `<p class="meldung" role="alert">${html(fehler)}</p>` : "";
  return rahmen(
    "Anmelden",
    `<section class="karte" aria-labelledby="titel">
<div class="kopf"><h1 id="titel">Firma wählen</h1><p class="muted">Melde dich an, um die Firmen zu sehen, in denen du Inhaber bist.</p></div>
${meldung}
<a class="btn btn-primary" href="/anmelden">Mit ${html(anbieter)} anmelden</a>
</section>`,
  );
}

/** Nach „Abmelden“ ohne Abmeldung beim Anmeldedienst: keine sofortige neue Anmeldung, erst auf Klick */
export function abgemeldetSeite(): string {
  return rahmen(
    "Abgemeldet",
    `<section class="karte" aria-labelledby="titel">
<div class="kopf"><h1 id="titel">Abgemeldet</h1></div>
<p class="hinweis" role="status">Du bist abgemeldet.</p>
<a class="btn btn-primary" href="/anmelden">Wieder anmelden</a>
</section>`,
  );
}

function suchfeld(suche: string): string {
  return `<form class="suche" method="get" action="/" role="search">
<label for="suche" class="visually-hidden">Firma suchen</label>
<input id="suche" name="suche" type="search" placeholder="Firma suchen" autocomplete="off" value="${html(suche)}">
<button class="btn" type="submit">Suchen</button>
</form>`;
}

/** Wie chevron-right in Haben (apps/web/src/components/Icon.tsx) */
const PFEIL =
  '<svg class="firma-pfeil" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

/** Eine Firma als ganze Zeile; `ziel` ist der Einstieg in die Instanz */
function firmaZeile(firma: Firma, ziel: string): string {
  const initiale = Array.from(firma.name.trim())[0]?.toLocaleUpperCase("de") ?? "";
  return `<li><a class="firma" href="${html(ziel)}"><span class="firma-zeichen" aria-hidden="true">${html(initiale)}</span><span class="firma-name">${html(firma.name)}</span>${PFEIL}</a></li>`;
}

/**
 * Die Firmen der Person. `einstieg` macht aus der Adresse einer Instanz den Link, `angemeldet` ist E-Mail oder Name
 * der Person aus dem Profil des Anmeldedienstes.
 */
export function firmenSeite(firmen: readonly Firma[], suche: string, angemeldet: string, einstieg: (url: string) => string): string {
  const gesucht = suche.trim().toLocaleLowerCase("de");
  const mitSuche = firmen.length >= SUCHE_AB;
  const treffer = mitSuche && gesucht ? firmen.filter((f) => f.name.toLocaleLowerCase("de").includes(gesucht)) : firmen;
  const liste =
    firmen.length === 0
      ? `<p>Du bist in keiner Firma als Inhaber eingetragen. Die Zuordnung kommt aus den Gruppen beim Anmeldedienst.</p>`
      : treffer.length === 0
        ? `<p role="status">Keine Firma gefunden.</p>`
        : `<ul class="firmen">${treffer.map((f) => firmaZeile(f, einstieg(f.url))).join("")}</ul>`;
  const wer = angemeldet ? `<p class="muted klein">Angemeldet als ${html(angemeldet)}</p>` : "<span></span>";
  return rahmen(
    "Firma wählen",
    `<section class="karte" aria-labelledby="titel">
<div class="kopf"><h1 id="titel">Firma wählen</h1></div>
${mitSuche ? suchfeld(suche) : ""}
${liste}
<div class="fuss">${wer}<form method="post" action="/abmelden"><button class="btn" type="submit">Abmelden</button></form></div>
</section>`,
  );
}

export function fehlerSeite(titel: string, text: string): string {
  return rahmen(
    titel,
    `<section class="karte" aria-labelledby="titel">
<div class="kopf"><h1 id="titel">${html(titel)}</h1></div>
<p>${html(text)}</p>
<a class="btn" href="/anmelden">Zur Anmeldung</a>
</section>`,
  );
}
