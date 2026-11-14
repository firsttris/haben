import { GEWICHTE } from "./schrift.ts";

/*
 * Stylesheet des Portals: Farben aus DESIGN.md (Wald, hell und dunkel nach dem Gerät), Abstände auf dem 4px-Raster,
 * Schriftgrößen 13, 14, 16, 18 und 24px. Die Firmen stehen als ganze Zeilen wie die Menüpunkte in Haben.
 */

const schriften = GEWICHTE.map(
  (g) =>
    `@font-face { font-family: "IBM Plex Sans"; font-style: normal; font-weight: ${g}; font-display: swap; src: url("/schrift/plex-${g}.woff2") format("woff2"); }`,
).join("\n");

export const STIL = `${schriften}
:root {
  color-scheme: light dark;
  --ink: #16211c; --muted: #56625c; --ground: #f4f5f2; --surface: #ffffff; --line: #dde2de; --line-soft: #eef0ee;
  --accent: #1f6f5c; --accent-hover: #174f42; --accent-ink: #17574a; --accent-soft: #e5f1ec; --accent-fg: #fff;
  --brand: #3fa284; --info-ink: #1d4e89; --info-soft: #e6eef8; --danger-ink: #9b1c1c; --danger-soft: #fbe4e4;
  --sans: "IBM Plex Sans", system-ui, sans-serif; --control-h: 40px; --shadow-xs: 0 1px 2px rgb(0 0 0 / 0.05); --fade: 0.15s ease;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #f4f4f5; --muted: #a1a1aa; --ground: #111113; --surface: #1a1a1d; --line: #2c2c31; --line-soft: #232327;
    --accent: #4cc29a; --accent-hover: #6dd0ad; --accent-ink: #7fd3b5; --accent-soft: #193a2f; --accent-fg: #111113;
    --info-ink: #a3c4ee; --info-soft: #1a2536; --danger-ink: #f2a8a8; --danger-soft: #371d1e; --shadow-xs: 0 1px 2px rgb(0 0 0 / 0.3);
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
.kopf { display: flex; flex-direction: column; gap: 4px; }
h1 { margin: 0; font-size: 24px; font-weight: 600; }
p { margin: 0; line-height: 1.5; }
.muted { color: var(--muted); }
.klein { font-size: 13px; }
.meldung { padding: 8px 12px; border-radius: 8px; background: var(--danger-soft); color: var(--danger-ink); }
.hinweis { padding: 8px 12px; border-radius: 8px; background: var(--info-soft); color: var(--info-ink); }
.btn { display: inline-flex; align-items: center; justify-content: center; min-height: var(--control-h); padding: 0 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); font: inherit; font-weight: 500; text-decoration: none; cursor: pointer; box-shadow: var(--shadow-xs); transition: background var(--fade); }
.btn:hover { background: var(--line-soft); }
.btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.firmen { list-style: none; margin: 0 -12px; padding: 0; width: calc(100% + 24px); display: flex; flex-direction: column; gap: 4px; }
.firma { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 8px 12px; border-radius: 8px; color: var(--ink); font-size: 16px; font-weight: 500; text-decoration: none; transition: background var(--fade); }
.firma:hover { background: var(--line-soft); }
.firma:focus-visible { outline-offset: -2px; }
.firma-zeichen { flex-shrink: 0; display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.firma-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.firma-pfeil { flex-shrink: 0; color: var(--muted); transition: transform var(--fade); }
.firma:hover .firma-pfeil { transform: translateX(2px); color: var(--ink); }
.fuss { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding-top: 16px; border-top: 1px solid var(--line-soft); }
.fuss .muted { min-width: 0; overflow-wrap: anywhere; }
.suche { display: flex; gap: 8px; width: 100%; }
.suche input { flex: 1; min-width: 0; min-height: var(--control-h); padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); font: inherit; }
.suche input:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
@media (prefers-reduced-motion: reduce) { .firma-pfeil, .btn, .firma { transition: none; } }
`;
