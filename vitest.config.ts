import { redact } from "@tanstack/redact/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Komponenten rendern in den Tests mit derselben Laufzeit wie in Browser und SSR (apps/web/vite.config.ts): redact() leitet
  // Imports aus react und react-dom/server um. @tanstack/redact steht deshalb auch in den Dev-Abhängigkeiten der Wurzel, mit
  // derselben festen Version wie in apps/web (Bun installiert isoliert; redact-laufzeit.test.ts prüft das). Pakete aus
  // node_modules lädt Vitest extern, sie sehen React: Eine Komponente mit Hooks eines solchen Pakets (etwa
  // @tanstack/react-router) bricht im Test mit dispatcher.useContext ab.
  plugins: [redact()],
  test: {
    include: ["{apps,packages}/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Die Testdateien laufen parallel; jeder Worker hat eine eigene Datenbank, geklont aus einer einmal migrierten Vorlage
    globalSetup: ["apps/web/src/server/test-db.ts"],
    // ERiC emuliert über ERIC_WORKER_COMMAND (arm64): Ein Aufruf dauert rund 25 statt einer Sekunde. Eigene Limits
    // der Tests mit echtem ERiC skaliert ericTestTimeout (packages/elster/test-fixtures/eric-zeit.ts)
    ...(process.env.ERIC_WORKER_COMMAND?.trim() ? { testTimeout: 300_000 } : {}),
  },
});
