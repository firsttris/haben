import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,packages}/*/src/**/*.test.ts"],
    // Die Testdateien laufen parallel; jeder Worker hat eine eigene Datenbank, geklont aus einer einmal migrierten Vorlage
    globalSetup: ["apps/web/src/server/test-db.ts"],
  },
});
