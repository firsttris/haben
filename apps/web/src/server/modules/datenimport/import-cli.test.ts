import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

const pdf = Buffer.from("%PDF-1.4\n%%EOF");
const hash = createHash("sha256").update(pdf).digest("hex");
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "haben-import-vorschau-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function preview(entries: unknown[], bytes = pdf) {
  const filename = join(directory, "bestand.json");
  await writeFile(filename, JSON.stringify({ version: 2, source: "test-cli", kontenrahmen: "SKR03", entries }));
  await writeFile(join(directory, `${hash}.pdf`), bytes);
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./import-cli.ts", import.meta.url)), "--paket", filename, "--originale", directory, "--akteur", "migration:test"],
    {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        DATABASE_URL: "postgres://test:test@127.0.0.1:1/nicht_erreichbar",
        BETTER_AUTH_SECRET: "x".repeat(32),
        BETTER_AUTH_URL: "http://localhost:3000",
        HABEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      },
    },
  );
}
const quote = {
  kind: "quote",
  externalId: "a-1",
  number: "A-1",
  date: "2026-01-03",
  contactId: null,
  contactName: "Testkunde",
  currency: "EUR",
  net: 100,
  tax: 0,
  gross: 100,
  pdfSha256: hash,
  status: "open",
};

it("prüft Originale in der CLI-Vorschau ohne erreichbare Datenbank und ohne Übernahme", async () => {
  const result = await preview([quote]);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ structureAndOriginalHashesChecked: true, entries: 1, targetNotChanged: true });
});

it("weist auch in der Vorschau ein verändertes Original ab", async () => {
  const result = await preview([quote], Buffer.from("%PDF-1.4\nverändert"));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Herkunfts-Hash");
  expect(result.stdout).toBe("");
});

it("meldet einen unausgeglichenen Stapelsatz vor der Übernahme", async () => {
  const result = await preview([
    {
      kind: "journal",
      externalId: "j-1",
      date: "2026-01-03",
      description: "Beispielsatz",
      lines: [
        { account: "1200", debit: 100, credit: 0 },
        { account: "1400", debit: 0, credit: 99 },
      ],
    },
  ]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("nicht ausgeglichen");
});
