import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageCacheRoot } from "@haben/einvoice";
import { describe, expect, it } from "vitest";
import { universeFetcher, PACKAGE_LIMITS, resolvePackages, writePackages } from "./paket-download.ts";
import { fakeUniverse, paketArchiv, tarEintrag } from "./test-paket.ts";

const p = (spec: string) => {
  const [name, version] = spec.split(":") as [string, string];
  return { name, version };
};

describe("Pakete aus Typst Universe laden", () => {
  it("findet Abhängigkeiten in den Importen, auch über mehrere Stufen, und lädt jedes Paket einmal", async () => {
    const universe = fakeUniverse({
      "@preview/a:1.0.0": paketArchiv("a", "1.0.0", '#import "@preview/b:2.0.0"\n#import "@preview/c:3.0.0"\n#import "@preview/a:1.0.0"'),
      "@preview/b:2.0.0": paketArchiv("b", "2.0.0", '#import "@preview/c:3.0.0"'),
      "@preview/c:3.0.0": paketArchiv("c", "3.0.0", "#let c = 1"),
    });
    const resolved = await resolvePackages([p("@preview/a:1.0.0")], universe);
    expect(resolved.map((r) => `${r.name}:${r.version}`)).toEqual(["@preview/a:1.0.0", "@preview/b:2.0.0", "@preview/c:3.0.0"]);
    expect(universe.abrufe).toEqual(["@preview/a:1.0.0", "@preview/b:2.0.0", "@preview/c:3.0.0"]);
  });

  it("lässt nur @preview zu", async () => {
    await expect(resolvePackages([p("@local/eigen:0.1.0")], fakeUniverse({}))).rejects.toThrow(/Nur Pakete aus @preview/);
  });

  it("begrenzt die Zahl der Pakete samt Abhängigkeiten", async () => {
    const archive: Record<string, Buffer> = {};
    for (let i = 0; i <= PACKAGE_LIMITS.maxPackages; i++) archive[`@preview/k${i}:1.0.0`] = paketArchiv(`k${i}`, "1.0.0", `#import "@preview/k${i + 1}:1.0.0"`);
    await expect(resolvePackages([p("@preview/k0:1.0.0")], fakeUniverse(archive))).rejects.toThrow(/mehr als 20 Pakete/);
  });

  it("lehnt eine Archivbombe ab", async () => {
    const bombe = paketArchiv("bombe", "1.0.0", "", [tarEintrag("./ballast.bin", Buffer.alloc(PACKAGE_LIMITS.maxUnpackedBytes + 1))]);
    expect(bombe.length).toBeLessThan(PACKAGE_LIMITS.maxArchiveBytes);
    await expect(resolvePackages([p("@preview/bombe:1.0.0")], fakeUniverse({ "@preview/bombe:1.0.0": bombe }))).rejects.toThrow(
      /@preview\/bombe:1\.0\.0: Das Paket ist entpackt größer als 20 MB/,
    );
  });

  it("begrenzt die entpackte Größe aller Pakete zusammen", async () => {
    const gross = (n: string, dep?: string) =>
      paketArchiv(n, "1.0.0", dep ? `#import "${dep}"` : "", [tarEintrag("./ballast.bin", Buffer.alloc(PACKAGE_LIMITS.maxUnpackedBytes - 1024 * 1024))]);
    const universe = fakeUniverse({
      "@preview/g1:1.0.0": gross("g1", "@preview/g2:1.0.0"),
      "@preview/g2:1.0.0": gross("g2", "@preview/g3:1.0.0"),
      "@preview/g3:1.0.0": gross("g3"),
    });
    await expect(resolvePackages([p("@preview/g1:1.0.0")], universe)).rejects.toThrow(/zusammen|entpackt größer als 50 MB/);
  });

  it("lehnt ein Archiv ab, das ein anderes Paket enthält", async () => {
    const universe = fakeUniverse({ "@preview/echt:1.0.0": paketArchiv("falsch", "1.0.0", "") });
    await expect(resolvePackages([p("@preview/echt:1.0.0")], universe)).rejects.toThrow(/enthält ein anderes Paket/);
  });

  it("lehnt Pfade außerhalb des Pakets ab", async () => {
    const boese = paketArchiv("boese", "1.0.0", "", [tarEintrag("../../ausbruch.typ", "x")]);
    await expect(resolvePackages([p("@preview/boese:1.0.0")], fakeUniverse({ "@preview/boese:1.0.0": boese }))).rejects.toThrow(/außerhalb des Pakets/);
  });

  it("schreibt die Pakete dorthin, wo Typst sie ohne Netz sucht", async () => {
    const dir = mkdtempSync(join(tmpdir(), "haben-paket-test-"));
    try {
      const resolved = await resolvePackages([p("@preview/a:1.0.0")], fakeUniverse({ "@preview/a:1.0.0": paketArchiv("a", "1.0.0", "#let a = 1") }));
      await writePackages(dir, resolved);
      expect(readFileSync(join(packageCacheRoot(dir), "preview", "a", "1.0.0", "lib.typ"), "utf8")).toBe("#let a = 1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Archiv aus Typst Universe holen", () => {
  const mitAntwort = async (response: Response, run: () => Promise<unknown>) => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => response) as unknown as typeof fetch;
    try {
      return await run();
    } finally {
      globalThis.fetch = original;
    }
  };

  it("bricht ab, sobald das Archiv größer wird als erlaubt, auch ohne Content-Length", async () => {
    let gesendet = 0;
    const endlos = new ReadableStream<Uint8Array>({
      pull(controller) {
        gesendet += 64 * 1024;
        controller.enqueue(new Uint8Array(64 * 1024));
      },
    });
    await mitAntwort(new Response(endlos), () => expect(universeFetcher()(p("@preview/gross:1.0.0"), 1024 * 1024)).rejects.toThrow(/gepackt größer als 1 MB/));
    expect(gesendet).toBeLessThan(2 * 1024 * 1024);
  });

  it("meldet ein unbekanntes Paket", async () => {
    await mitAntwort(new Response("nicht da", { status: 404 }), () =>
      expect(universeFetcher()(p("@preview/fehlt:1.0.0"), 1024)).rejects.toThrow(/gibt es in Typst Universe nicht/),
    );
  });
});
