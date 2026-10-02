import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";

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
  plugins: [
    keepNativeExternal(),
    tanstackStart(),
    // die native Bindung löst der Server zur Laufzeit aus apps/web/node_modules auf
    nitro({ plugins: ["./src/server/plugins/scheduler.ts"] }),
    viteReact(),
  ],
});
