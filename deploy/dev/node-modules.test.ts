import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * Jeder Workspace hat im Dev-Container ein eigenes Volume für node_modules (compose.yml). Das Ziel muss im Image schon
 * als Ordner des Benutzers bun liegen (Containerfile), sonst gehört ein neues Volume root, und start.sh muss es nach
 * einem Neubau mit anderer UID wieder bun geben; fehlt es dort, scheitert bun install mit EACCES.
 */

const lies = (pfad: string) => readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8");

const compose = lies("compose.yml");
const containerfile = lies("deploy/dev/Containerfile");
const start = lies("deploy/dev/start.sh");

const ziele = [...compose.matchAll(/- node_modules\w*:(\/app\/\S*node_modules)$/gm)].map((m) => m[1]!);
const workspaces = ["apps", "packages"].flatMap((ordner) =>
  readdirSync(new URL(`../../${ordner}`, import.meta.url), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `/app/${ordner}/${e.name}/node_modules`),
);

describe("node_modules im Dev-Container", () => {
  it("hat für jeden Workspace ein Volume in compose.yml", () => {
    expect(ziele).toEqual(expect.arrayContaining(["/app/node_modules", ...workspaces]));
  });

  it.each(ziele)("%s wird im Containerfile angelegt und in start.sh dem Benutzer bun gegeben", (ziel) => {
    expect(containerfile.split(/\s+/)).toContain(ziel);
    expect(start.split(/[\s"]+/)).toContain(ziel);
  });
});
