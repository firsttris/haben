import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { redact } from "@tanstack/redact/vite";

// Version der ausgelieferten App, angezeigt unten in der Navigation
const VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

const NATIVE = ["@myriaddreamin/typst-ts-node-compiler"];

/** Native Typst-Bindung in keiner Umgebung vorbündeln, sondern zur Laufzeit laden. */
function keepNativeExternal(): Plugin {
  return {
    name: "haben:keep-native-external",
    configEnvironment(_name, config) {
      config.optimizeDeps = { ...config.optimizeDeps, exclude: [...(config.optimizeDeps?.exclude ?? []), ...NATIVE, "@haben/einvoice"] };
      config.resolve = { ...config.resolve, external: NATIVE };
    },
  };
}

export default defineConfig({
  server: { port: 3000 },
  // Abhängigkeiten des Servers mitbündeln, damit redact() auch deren React-Imports umleitet (README von TanStack Redact)
  ssr: { noExternal: true },
  define: { __HABEN_VERSION__: JSON.stringify(VERSION) },
  plugins: [
    keepNativeExternal(),
    tanstackStart(),
    // die native Bindung löst der Server zur Laufzeit aus apps/web/node_modules auf
    // compressPublicAssets: .br/.gz neben den Assets, auch ohne komprimierenden Proxy davor;
    // preset node-server: Der Server läuft unter Bun über node:http. Nicht das Preset bun (Bun.serve), das Nitro
    // unter Bun sonst selbst wählt: Bun.serve trennt jede Antwort, die länger als idleTimeout (10 s) braucht,
    // und Nitro reicht dafür keine Einstellung durch (e2e/langsame-anfrage.spec.ts)
    nitro({
      preset: "node-server",
      plugins: ["./src/server/plugins/scheduler.ts", "./src/server/plugins/setup-code.ts", "./src/server/plugins/datenbank.ts"],
      compressPublicAssets: { gzip: true, brotli: true },
    }),
    viteReact(),
    // TanStack Redact statt React im Browser und beim SSR: gleiche API, etwa halb so großes Start-Bundle.
    // Rendert synchron, ohne Time-Slicing; Haben nutzt weder useTransition noch useDeferredValue
    redact(),
  ],
});
