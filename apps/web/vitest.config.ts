import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import wurzel from "../../vitest.config.ts";

/**
 * Vitest aus apps/web heraus: dieselbe Konfiguration wie aus der Wurzel (`bun run test`). Ohne diese Datei nähme Vitest
 * vite.config.ts und startete mit Nitro die Server-Plugins der App, also Scheduler und Startprüfung gegen die
 * DATABASE_URL der Umgebung.
 */
export default mergeConfig(wurzel, defineConfig({ root: fileURLToPath(new URL("../..", import.meta.url)) }));
