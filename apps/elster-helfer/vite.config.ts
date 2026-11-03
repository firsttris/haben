import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import manifest from "./manifest.json" with { type: "json" };

// @crxjs/vite-plugin baut aus manifest.json die Erweiterung: Inhaltsskript und Popup aus TypeScript, Icons dazu.
// Die Version setzt beim Release scripts/elster-helfer/paket.ts aus dem Tag.
// Das Inhaltsskript als ein Bündel ohne Lader: Der Lader lädt Module nach und gibt sie dafür als
// web_accessible_resources für www.elster.de frei, womit Mein ELSTER die Erweiterung erkennen könnte.
export default defineConfig({
  plugins: [crx({ manifest, contentScripts: { standaloneFiles: ["src/content.ts"] } })],
  build: { outDir: "dist", emptyOutDir: true },
});
