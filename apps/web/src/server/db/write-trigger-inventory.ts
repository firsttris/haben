import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { readTriggerInventory } from "./trigger-inventory.ts";

// TEST_DATABASE_URL ist nur der Einstieg für CREATEDB. Der Bestand wird immer aus allen Migrationen neu aufgebaut;
// weder die dort vorhandenen Trigger noch DATABASE_URL dienen als Vorlage. Aufruf siehe docs/entwicklung.md.
const baseUrl = process.env.TEST_DATABASE_URL;
if (!baseUrl) throw new Error("TEST_DATABASE_URL fehlt; der Sollbestand braucht eine frisch migrierte Testdatenbank");
const name = `haben_trigger_inventory_${randomUUID().replaceAll("-", "")}`;
const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
const url = new URL(baseUrl);
url.pathname = `/${name}`;
const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
let created = false;
try {
  await admin`create database ${admin(name)}`;
  created = true;
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../drizzle", import.meta.url)) });
  const inventory = await readTriggerInventory(db);
  const file = fileURLToPath(new URL("./trigger-inventory.json", import.meta.url));
  const formatted = spawnSync(process.execPath, ["--bun", "biome", "format", "--stdin-file-path", file], {
    input: JSON.stringify(inventory),
    encoding: "utf8",
    cwd: fileURLToPath(new URL("../../../../../", import.meta.url)),
  });
  if (formatted.status !== 0) throw new Error(`Sollbestand konnte nicht formatiert werden: ${formatted.stderr}`);
  writeFileSync(file, formatted.stdout);
  console.info(`Sollbestand aus frischen Migrationen: ${inventory.triggers.length} Trigger, ${inventory.functions.length} Funktionen`);
} finally {
  await client.end();
  if (created) await admin`drop database ${admin(name)}`;
  await admin.end();
}
