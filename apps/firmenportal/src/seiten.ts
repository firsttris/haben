import type { Firma } from "@haben/core";

/*
 * Die Seiten des Firmenportals, auf dem Server als HTML gerendert: kein Skript, damit die Content Security Policy nur
 * 'self' für das Stylesheet braucht. Jeder Text aus der Konfiguration oder der Anfrage geht durch `html`.
 */

/** Ab so vielen Firmen steht über der Liste ein Suchfeld, wie im FirmaWechsler von Haben */
export const SUCHE_AB = 20;

const ZEICHEN: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const html = (text: string) => text.replace(/[&<>"']/g, (z) => ZEICHEN[z]!);

/** Eine Firma auf der Seite (#1036): `farbe` als #RRGGBB, `logo` als Adresse des Bildes im Firmenportal */
export interface FirmaKachel extends Firma {
  farbe?: string | null;
  logo?: string | null;
}

function rahmen(titel: string, inhalt: string, farben?: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${html(titel)} · Haben Firmenportal</title>
<link rel="stylesheet" href="/stil.css">${farben ? `\n<link rel="stylesheet" href="${html(farben)}">` : ""}
</head>
<body>
<main class="portal">
<header class="marke"><span class="zeichen" aria-hidden="true">H</span><span class="marke-text">Haben <span class="marke-ort">Firmenportal</span></span></header>
${inhalt}
</main>
</body>
</html>`;
}

/** `ziel`: der nächste Versuch; aus Haben mit ?von=haben, damit es bei einer Firma nicht zurück in die Instanz geht */
export function anmeldeSeite(anbieter: string, fehler?: string, ziel = "/anmelden"): string {
  const meldung = fehler ? `<p class="meldung" role="alert">${html(fehler)}</p>` : "";
  return rahmen(
    "Anmelden",
    `<section class="karte" aria-labelledby="titel">
<div class="kopf"><h1 id="titel">Firma wählen</h1><p class="muted">Melde dich an, um die Firmen zu sehen, in denen du Inhaber bist.</p></div>
${meldung}
<div class="aktionen"><a class="btn btn-primary" href="${html(ziel)}">Mit ${html(anbieter)} anmelden</a></div>
</section>`,
  );
}

/**
 * Nach „Abmelden“: keine sofortige neue Anmeldung, erst auf Klick. `beimDienst`: zurück von der Abmeldung beim
 * Anmeldedienst; sonst bietet er keine an, und man bleibt dort angemeldet (Rückmeldung in #1006)
 */
export function abgemeldetSeite(anbieter: string, beimDienst: boolean): string {
  const text = beimDienst
    ? `Du bist im Firmenportal und bei ${html(anbieter)} abgemeldet.`
    : `Du bist im Firmenportal abgemeldet. Bei ${html(anbieter)} bist du weiter angemeldet; „Wieder anmelden“ führt ohne neue Rückfrage hinein. Abmelden kannst du dich dort selbst.`;
  return rahmen(
    "Abgemeldet",
    `<section class="karte" aria-labelledby="titel">
<div class="kopf"><h1 id="titel">Abgemeldet</h1></div>
<p class="hinweis" role="status">${text}</p>
<div class="aktionen"><a class="btn btn-primary" href="/anmelden">Wieder anmelden</a></div>
</section>`,
  );
}

function suchfeld(suche: string): string {
  return `<form class="suche" method="get" action="/" role="search">
<label for="suche" class="visually-hidden">Firma suchen</label>
<input id="suche" name="suche" type="search" placeholder="Firma suchen" autocomplete="off" value="${html(suche)}"${suche.trim() ? " autofocus" : ""}>
<button class="btn" type="submit">Suchen</button>
</form>`;
}

/** Wie chevron-right in Haben (apps/web/src/components/Icon.tsx) */
const PFEIL =
  '<svg class="firma-pfeil" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

/** Logo, sonst Anfangsbuchstabe auf eigener Farbe oder der des Firmenportals; für Screenreader zählt nur der Name */
function kachel(firma: FirmaKachel): string {
  // Wie .brand-logo in Haben (NavMarkSymbol) ist das Bild selbst die Kachel: feste Größe, das Logo darin eingepasst
  if (firma.logo) return `<img class="firma-zeichen firma-logo" src="${html(firma.logo)}" alt="" width="32" height="32">`;
  const initiale = Array.from(firma.name.trim())[0]?.toLocaleUpperCase("de") ?? "";
  const farbe = firma.farbe ? ` farbe-${firma.farbe.slice(1)}` : "";
  return `<span class="firma-zeichen${html(farbe)}" aria-hidden="true">${html(initiale)}</span>`;
}

/** Eine Firma als ganze Zeile; `ziel` ist der Einstieg in die Instanz */
function firmaZeile(firma: FirmaKachel, ziel: string): string {
  return `<li><a class="firma" href="${html(ziel)}">${kachel(firma)}<span class="firma-name">${html(firma.name)}</span>${PFEIL}</a></li>`;
}

/**
 * Die Firmen der Person. `einstieg` macht aus der Adresse einer Instanz den Link, `angemeldet` ist E-Mail oder Name
 * der Person aus dem Profil des Anmeldedienstes, `farben` die Adresse des Stylesheets mit den Farben der Kacheln.
 */
export function firmenSeite(firmen: readonly FirmaKachel[], suche: string, angemeldet: string, einstieg: (url: string) => string, farben?: string): string {
  const gesucht = suche.trim().toLocaleLowerCase("de");
  const mitSuche = firmen.length >= SUCHE_AB;
  const treffer = mitSuche && gesucht ? firmen.filter((f) => f.name.toLocaleLowerCase("de").includes(gesucht)) : firmen;
  // Ohne Skript lädt die Suche die Seite neu: Das Feld behält den Fokus (autofocus), die Zahl sagt das Ergebnis an
  const anzahl = mitSuche && gesucht ? `<p class="muted klein" role="status">${treffer.length} von ${firmen.length} Firmen</p>` : "";
  const liste =
    firmen.length === 0
      ? `<p>Du bist in keiner Firma als Inhaber eingetragen. Die Zuordnung kommt aus den Gruppen beim Anmeldedienst. Wende dich an die Person, die Haben für dich betreibt.</p>`
      : treffer.length === 0
        ? `<p role="status">Keine Firma gefunden.</p>`
        : `${anzahl}<ul class="firmen">${treffer.map((f) => firmaZeile(f, einstieg(f.url))).join("")}</ul>`;
  const wer = angemeldet ? `<p class="muted klein">Angemeldet als ${html(angemeldet)}</p>` : "<span></span>";
  return rahmen(
    "Firma wählen",
    `<section class="karte" aria-labelledby="titel">
<div class="kopf"><h1 id="titel">Firma wählen</h1></div>
${mitSuche ? suchfeld(suche) : ""}
${liste}
<div class="fuss">${wer}<form method="post" action="/abmelden"><button class="btn" type="submit">Abmelden</button></form></div>
</section>`,
    farben,
  );
}

export function fehlerSeite(titel: string, text: string): string {
  return rahmen(
    titel,
    `<section class="karte" aria-labelledby="titel">
<div class="kopf"><h1 id="titel">${html(titel)}</h1></div>
<p>${html(text)}</p>
<div class="aktionen"><a class="btn" href="/anmelden">Zur Anmeldung</a></div>
</section>`,
  );
}
