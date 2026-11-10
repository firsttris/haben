// Erzeugt die Symbole der README (docs/icons/*.svg) aus den Symbolen der App (apps/web/src/components/Icon.tsx):
// dieselben Pfade und Strichstärke, auf einer Kachel in Akzentfarbe, hell (Wald) und dunkel (Nacht) per
// prefers-color-scheme im SVG. GitHub zeigt sie als <img>; die Kachel folgt dabei der Einstellung des Systems.
// Was die App nicht hat (GmbH, Schlüssel …), steht unten in EXTRA im selben Raster: 24 × 24, Strich 1,8, runde Enden.
// Aufruf: bun run docs:icons
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Icon, type IconName } from "../../apps/web/src/components/Icon.tsx";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
// React ist eine Abhängigkeit von apps/web, nicht vom Wurzelpaket
const { renderToStaticMarkup } = createRequire(path.join(root, "apps/web/package.json"))("react-dom/server") as typeof import("react-dom/server");

/** Symbole, die nur die README braucht, im Stil von Icon.tsx */
const EXTRA = {
  building: '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M2 21h20M8 8h3M8 12h3M8 16h3"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  upload: '<path d="M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  access: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="7.5" r="1"/><path d="M8 10.5l4 1 4-1M12 11.5v3M10 18l2-3.5 2 3.5"/>',
  server:
    '<rect x="4" y="4" width="16" height="7" rx="1"/><rect x="4" y="13" width="16" height="7" rx="1"/><path d="M8 7.5h.01M8 16.5h.01M12 7.5h4M12 16.5h4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.3 2-2.3 3.5M12 17h.01"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M9 8a3 3 0 0 1 6 0M12 12v8M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 19l3-2M20 19l-3-2"/>',
} as const;

/** Aus der App, Name in der README → Name in Icon.tsx */
const APP: Record<string, IconName> = {
  overview: "overview",
  invoice: "invoice",
  quote: "quote",
  textblock: "textblock",
  receipt: "receipt",
  bank: "bank",
  cash: "cash",
  assets: "assets",
  payroll: "payroll",
  vat: "vat",
  annual: "annual",
  mail: "mail",
  journal: "journal",
  reports: "reports",
  archive: "archive",
  code: "code",
  external: "external",
  docs: "docs",
  contacts: "contacts",
  eye: "eye",
  info: "info",
};

/** Innenleben eines App-Symbols ohne das umschließende <svg> */
function appPaths(name: IconName): string {
  const markup = renderToStaticMarkup(Icon({ name }));
  return markup.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
}

// Farben wie --accent-soft/--accent-ink in Wald und Nacht (apps/web/src/styles.css)
const tile = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
<style>
.k{fill:#e5f1ec}.s{fill:none;stroke:#17574a;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
@media (prefers-color-scheme:dark){.k{fill:#1d3a31}.s{stroke:#7fd3b5}}
</style>
<rect class="k" width="28" height="28" rx="7"/>
<g class="s" transform="translate(5 5) scale(.75)">${inner}</g>
</svg>
`;

const out = path.join(root, "docs/icons");
mkdirSync(out, { recursive: true });
const all: [string, string][] = [...Object.entries(APP).map(([file, name]) => [file, appPaths(name)] as [string, string]), ...Object.entries(EXTRA)];
for (const [file, inner] of all) writeFileSync(path.join(out, `${file}.svg`), tile(inner));
console.log(`${all.length} Symbole nach ${out}`);
