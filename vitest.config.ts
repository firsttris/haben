import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,packages}/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Die Testdateien laufen parallel; jeder Worker hat eine eigene Datenbank, geklont aus einer einmal migrierten Vorlage
    globalSetup: ["apps/web/src/server/test-db.ts"],
    // ERiC emuliert über ERIC_WORKER_COMMAND (arm64): Ein Aufruf dauert rund 25 statt einer Sekunde. Eigene Limits
    // der Tests mit echtem ERiC skaliert ericTestTimeout (packages/elster/test-fixtures/eric-zeit.ts)
    ...(process.env.ERIC_WORKER_COMMAND?.trim() ? { testTimeout: 300_000 } : {}),
  },
});
