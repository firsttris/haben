import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ericDownloadUrl, ericHomeIn, installedEricVersion, installEric, type InstallProgress } from "./install.ts";

const big = randomBytes(3 * 1024 * 1024);

function jar(files: Record<string, Uint8Array>) {
  return zipSync(files, { level: 6 });
}

const goodJar = jar({
  "ERiC-43.4.6.0/Linux-x86_64/lib/libericapi.so": new TextEncoder().encode("api"),
  "ERiC-43.4.6.0/Linux-x86_64/lib/libericxerces.so": big,
  "ERiC-43.4.6.0/Linux-x86_64/lib/plugins/libcheckUStVA_2026.so": new TextEncoder().encode("plugin"),
  "ERiC-43.4.6.0/Windows-x86_64/dll/ericapi.dll": new TextEncoder().encode("win"),
  "ERiC-43.4.6.0/Dokumentation/Liesmich.txt": new TextEncoder().encode("doku"),
});

function fakeFetch(body: Uint8Array | null, status = 200) {
  const urls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(body as BodyInit | null, { status, headers: body ? { "content-length": String(body.length) } : {} });
  }) as typeof fetch;
  return { fn, urls };
}

async function tempDir() {
  return mkdtemp(join(tmpdir(), "eric-test-"));
}

describe("ERiC installieren", () => {
  it("baut die Download-Adresse aus der Version", () => {
    expect(ericDownloadUrl("43.4.6.0")).toBe("https://download.elster.de/download/eric/eric_43/ERiC-43.4.6.0-Linux-x86_64.jar");
    expect(() => ericDownloadUrl("../../etc")).toThrow(/Ungültige/);
  });

  it("lädt herunter und entpackt nur Linux x86_64", async () => {
    const dir = join(await tempDir(), "eric");
    const { fn, urls } = fakeFetch(goodJar);
    const progress: InstallProgress[] = [];
    const result = await installEric({ version: "43.4.6.0", dir, fetch: fn, baseUrl: "http://elster.test/eric", checkPlatform: false, onProgress: (p) => progress.push(p) });
    expect(urls).toEqual(["http://elster.test/eric/eric_43/ERiC-43.4.6.0-Linux-x86_64.jar"]);
    expect(result).toEqual({ version: "43.4.6.0", files: 3 });
    const home = ericHomeIn(dir)!;
    expect(home).toBe(join(dir, "ERiC-43.4.6.0"));
    expect(readFileSync(join(home, "lib/libericxerces.so")).equals(big)).toBe(true);
    expect(existsSync(join(home, "dll"))).toBe(false);
    expect(await installedEricVersion(home)).toBe("43.4.6.0");
    expect(progress.at(-1)?.phase).toBe("fertig");
  });

  it("schaltet erst auf die neue Version um, wenn sie vollständig ist, und räumt danach auf", async () => {
    const dir = join(await tempDir(), "eric");
    // Von Hand entpacktes ERiC direkt im Verzeichnis
    await mkdir(join(dir, "lib/plugins2"), { recursive: true });
    await writeFile(join(dir, "lib/libericapi.so"), "hand");
    expect(ericHomeIn(dir)).toBe(dir);

    const broken = jar({ "ERiC-44.0.0.0/Linux-x86_64/lib/libericapi.so": new TextEncoder().encode("neu") });
    await expect(installEric({ version: "44.0.0.0", dir, fetch: fakeFetch(broken).fn, checkPlatform: false })).rejects.toThrow(/lib\/plugins/);
    expect(ericHomeIn(dir)).toBe(dir);
    await expect(installEric({ version: "44.0.0.0", dir, fetch: fakeFetch(null, 404).fn, checkPlatform: false })).rejects.toThrow(/nicht \(mehr\)/);

    await installEric({ version: "43.4.6.0", dir, fetch: fakeFetch(goodJar).fn, checkPlatform: false });
    expect(readFileSync(join(ericHomeIn(dir)!, "lib/libericapi.so"), "utf8")).toBe("api");
    const next = jar({
      "ERiC-44.1.0.0/Linux-x86_64/lib/libericapi.so": new TextEncoder().encode("v44"),
      "ERiC-44.1.0.0/Linux-x86_64/lib/plugins2/libcheckUSt_2026.so": new TextEncoder().encode("p"),
    });
    await installEric({ version: "44.1.0.0", dir, fetch: fakeFetch(next).fn, checkPlatform: false });
    expect(ericHomeIn(dir)).toBe(join(dir, "ERiC-44.1.0.0"));
    // Dieselbe Version erneut: landet neben der laufenden, AKTUELL wird nur umgeschaltet
    await installEric({ version: "44.1.0.0", dir, fetch: fakeFetch(next).fn, checkPlatform: false });
    expect((await readdir(dir)).filter((e) => e.startsWith("ERiC-") || e === "AKTUELL").sort()).toEqual(["AKTUELL", "ERiC-44.1.0.0-2"]);
    expect(await installedEricVersion(ericHomeIn(dir)!)).toBe("44.1.0.0");
    await installEric({ version: "44.1.0.0", dir, fetch: fakeFetch(next).fn, checkPlatform: false });
    expect((await readdir(dir)).filter((e) => e.startsWith("ERiC-") || e === "AKTUELL").sort()).toEqual(["AKTUELL", "ERiC-44.1.0.0"]);
    expect(ericHomeIn(dir)).toBe(join(dir, "ERiC-44.1.0.0"));
  });

  it("lehnt Pakete ohne Linux-Teil und Pfade außerhalb des Ziels ab", async () => {
    const dir = join(await tempDir(), "eric");
    const windows = jar({ "ERiC-43.4.6.0/Windows-x86_64/dll/ericapi.dll": new TextEncoder().encode("win") });
    await expect(installEric({ version: "43.4.6.0", dir, fetch: fakeFetch(windows).fn, checkPlatform: false })).rejects.toThrow(/keine Dateien/);
    const evil = jar({ "ERiC/Linux-x86_64/../../../boese.so": new TextEncoder().encode("x") });
    await expect(installEric({ version: "43.4.6.0", dir, fetch: fakeFetch(evil).fn, checkPlatform: false })).rejects.toThrow(/Unzulässiger Pfad|keine Dateien/);
    expect(existsSync(join(dir, "..", "boese.so"))).toBe(false);
  });

  it("meldet ein defektes Archiv als Fehler, ohne unhandled rejection und ohne Reste", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const dir = join(await tempDir(), "eric");
      // Komprimierte Daten mitten im großen Eintrag verfälschen bzw. das Archiv abschneiden
      const corrupt = goodJar.slice();
      corrupt.fill(0xff, 200_000, 400_000);
      await expect(installEric({ version: "43.4.6.0", dir, fetch: fakeFetch(corrupt).fn, checkPlatform: false })).rejects.toThrow();
      const truncated = goodJar.slice(0, Math.floor(goodJar.length / 2));
      await expect(installEric({ version: "43.4.6.0", dir, fetch: fakeFetch(truncated).fn, checkPlatform: false })).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
      expect(await readdir(dir)).toEqual([]);
      expect(ericHomeIn(dir)).toBeNull();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
