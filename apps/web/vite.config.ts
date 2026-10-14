import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

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
  define: { __HABEN_VERSION__: JSON.stringify(VERSION) },
  plugins: [
    keepNativeExternal(),
    tanstackStart(),
    // die native Bindung löst der Server zur Laufzeit aus apps/web/node_modules auf
    // compressPublicAssets: .br/.gz neben den Assets, auch ohne komprimierenden Proxy davor
    nitro({ plugins: ["./src/server/plugins/scheduler.ts"], compressPublicAssets: { gzip: true, brotli: true } }),
    viteReact(),
  ],
});
