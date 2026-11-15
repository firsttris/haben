import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/*
 * documents.ts ist der Einstieg für Skripte, Tests und Werkzeuge, die nur die Belegfunktionen brauchen. Über den
 * Ring documents -> bank/index -> bank/bank -> belege/index -> inbox -> documents las inbox.ts beim Laden
 * MAX_DOCUMENT_SIZE aus diesem Modul, das noch nicht fertig ausgewertet war: der Einstieg brach mit
 * „Cannot access MAX_DOCUMENT_SIZE before initialization“ ab (#1063).
 *
 * Geprüft wird das in Bun, nicht in Vitest: Vites Module-Ausführung liefert für einen noch nicht gesetzten Export
 * keinen ReferenceError, sondern undefined — die Mailgrenze wäre dort still NaN und der Fehler unsichtbar. Der
 * Lauf in einem eigenen Prozess ist der Weg aus dem Issue und startet in unter einer Sekunde.
 */
describe("documents.ts als Einstieg", () => {
  const eintritt = fileURLToPath(new URL("documents.ts", import.meta.url));
  const arbeitsverzeichnis = fileURLToPath(new URL("../../../../", import.meta.url));

  beforeAll(() => {
    Object.assign(process.env, {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://localhost/haben",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "x".repeat(32),
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "https://haben.example.de",
      HABEN_ENCRYPTION_KEY: process.env.HABEN_ENCRYPTION_KEY ?? Buffer.alloc(32).toString("base64"),
    });
  });

  it("lädt den Modulring, ohne an der Belegobergrenze zu scheitern", { timeout: 60_000 }, () => {
    // Import wie im Repro des Issues: dieses Modul zuerst, ohne Barrel davor
    const skript = [
      `import { MAX_DOCUMENT_SIZE, runExtraction } from ${JSON.stringify(eintritt)};`,
      `if (typeof runExtraction !== "function") throw new Error("runExtraction fehlt");`,
      `if (MAX_DOCUMENT_SIZE !== 20 * 1024 * 1024) throw new Error("Belegobergrenze: " + MAX_DOCUMENT_SIZE);`,
    ].join(" ");
    expect(() =>
      execFileSync("bun", ["-e", skript], {
        cwd: arbeitsverzeichnis,
        env: process.env,
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
