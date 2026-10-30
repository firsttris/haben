import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ericHomeIn, installEric } from "./install.ts";

function fakeFetch(body: Uint8Array) {
  return (async () => new Response(body as BodyInit, { status: 200, headers: { "content-length": String(body.length) } })) as typeof fetch;
}

describe("ERiC installieren (Review)", () => {
  it("entpackt leere, unkomprimiert gespeicherte Dateien (Kommentar in extractEntry: „leere Dateien brauchen das“)", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "eric-review-")), "eric");
    // level 0: Methode 0 (stored), leere Datei hat compressedSize 0
    const stored = zipSync(
      {
        "ERiC-43.4.6.0/Linux-x86_64/lib/libericapi.so": new TextEncoder().encode("api"),
        "ERiC-43.4.6.0/Linux-x86_64/lib/plugins/libcheckUStVA_2026.so": new TextEncoder().encode("plugin"),
        "ERiC-43.4.6.0/Linux-x86_64/lib/plugins/leer.txt": new Uint8Array(0),
      },
      { level: 0 },
    );
    await expect(installEric({ version: "43.4.6.0", dir, fetch: fakeFetch(stored), checkPlatform: false })).resolves.toMatchObject({ version: "43.4.6.0", files: 3 });
    const home = ericHomeIn(dir)!;
    expect(existsSync(join(home, "lib/plugins/leer.txt"))).toBe(true);
    expect(readFileSync(join(home, "lib/plugins/leer.txt")).length).toBe(0);
  });
});
