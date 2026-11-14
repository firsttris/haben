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
<h1 id="titel">Firma wählen</h1>
<p class="muted">Melde dich an, um die Firmen zu sehen, in denen du Inhaber bist.</p>
${meldung}
<a class="btn btn-primary" href="/anmelden">Mit ${html(anbieter)} anmelden</a>
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

export function firmenSeite(firmen: readonly Firma[], suche: string): string {
  const gesucht = suche.trim().toLocaleLowerCase("de");
  const mitSuche = firmen.length >= SUCHE_AB;
  const treffer = mitSuche && gesucht ? firmen.filter((f) => f.name.toLocaleLowerCase("de").includes(gesucht)) : firmen;
  const liste =
    firmen.length === 0
      ? `<p>Du bist in keiner Firma als Inhaber eingetragen. Die Zuordnung kommt aus den Gruppen beim Anmeldedienst.</p>`
      : treffer.length === 0
        ? `<p role="status">Keine Firma gefunden.</p>`
        : `<ul class="firmen">${treffer.map((f) => `<li><a href="${html(f.url)}">${html(f.name)}</a></li>`).join("")}</ul>`;
  return rahmen(
    "Firma wählen",
    `<section class="karte" aria-labelledby="titel">
<h1 id="titel">Firma wählen</h1>
${mitSuche ? suchfeld(suche) : ""}
${liste}
<form method="post" action="/abmelden"><button class="btn btn-ghost" type="submit">Abmelden</button></form>
</section>`,
  );
}

export function fehlerSeite(titel: string, text: string): string {
  return rahmen(
    titel,
    `<section class="karte" aria-labelledby="titel">
<h1 id="titel">${html(titel)}</h1>
<p>${html(text)}</p>
<a class="btn" href="/">Zur Anmeldung</a>
</section>`,
  );
}

/** Farben aus DESIGN.md (Wald, hell und dunkel nach dem Gerät), Abstände auf dem 4px-Raster */
export const STIL = `:root {
  color-scheme: light dark;
  --ink: #16211c; --muted: #56625c; --ground: #f4f5f2; --surface: #ffffff; --line: #dde2de; --line-soft: #eef0ee;
  --accent: #1f6f5c; --accent-hover: #174f42; --accent-fg: #fff; --link: var(--accent); --link-hover: var(--accent-hover);
  --brand: #3fa284; --danger-ink: #9b1c1c; --danger-soft: #fbe4e4;
  --sans: "IBM Plex Sans", system-ui, sans-serif; --control-h: 40px; --shadow-xs: 0 1px 2px rgb(0 0 0 / 0.05); --fade: 0.15s ease;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #f4f4f5; --muted: #a1a1aa; --ground: #111113; --surface: #1a1a1d; --line: #2c2c31; --line-soft: #232327;
    --accent: #4cc29a; --accent-hover: #6dd0ad; --accent-fg: #111113; --link: #7fd3b5; --link-hover: var(--ink);
    --danger-ink: #f2a8a8; --danger-soft: #371d1e; --shadow-xs: 0 1px 2px rgb(0 0 0 / 0.3);
  }
}
@media (pointer: coarse) { :root { --control-h: 44px; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: var(--ground); color: var(--ink); font-family: var(--sans); font-size: 14px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.portal { max-width: 480px; margin: 0 auto; padding: 48px 16px; display: flex; flex-direction: column; gap: 24px; }
.marke { display: flex; align-items: center; gap: 12px; font-size: 18px; font-weight: 600; }
.zeichen { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 8px; background: var(--brand); color: #fff; font-size: 20px; }
.karte { display: flex; flex-direction: column; align-items: flex-start; gap: 16px; padding: 24px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-xs); }
h1 { margin: 0; font-size: 24px; font-weight: 600; }
p { margin: 0; line-height: 1.5; }
.muted { color: var(--muted); }
.meldung { padding: 8px 12px; border-radius: 8px; background: var(--danger-soft); color: var(--danger-ink); }
.btn { display: inline-flex; align-items: center; justify-content: center; min-height: var(--control-h); padding: 0 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); font: inherit; font-weight: 500; text-decoration: none; cursor: pointer; box-shadow: var(--shadow-xs); transition: background var(--fade); }
.btn:hover { background: var(--line-soft); }
.btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn-primary:hover { background: var(--accent-hover); }
.btn-ghost { border-color: transparent; background: transparent; box-shadow: none; padding: 0 8px; }
.firmen { list-style: none; margin: 0; padding: 0; width: 100%; display: flex; flex-direction: column; }
.firmen li + li { border-top: 1px solid var(--line-soft); }
.firmen a { display: flex; align-items: center; min-height: 44px; padding: 8px 4px; color: var(--link); font-weight: 500; font-size: 16px; overflow-wrap: anywhere; }
.firmen a:hover { color: var(--link-hover); }
.suche { display: flex; gap: 8px; width: 100%; }
.suche input { flex: 1; min-width: 0; min-height: var(--control-h); padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); font: inherit; }
.suche input:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
`;
