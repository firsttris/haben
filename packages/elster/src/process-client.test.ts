import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { buildNachrichtXml } from "./nachricht.ts";
import { EricProcessClient } from "./process-client.ts";
import { buildUstvaXml, TEST_HERSTELLER_ID } from "./xml.ts";

const fixtures = fileURLToPath(new URL("../test-fixtures/", import.meta.url));
const stub = (name: string, timeoutMs?: number) =>
  new EricProcessClient({ ericHome: "/opt/eric", workerPath: join(fixtures, `worker-${name}.mjs`), timeoutMs });

const xml = (test = true) =>
  buildUstvaXml({
    period: { year: 2026, month: 2 },
    steuernummer13: "9198011310010",
    figures: { kz81: 100_000, kz86: 0, kz66: 0, kz83: 19_000 },
    datenlieferant: { name: "A", strasse: "B", plz: "1", ort: "C" },
    herstellerId: TEST_HERSTELLER_ID,
    produktVersion: "0.1.0",
    test,
  });

const ericTempDirs = () => readdirSync(tmpdir()).filter((name) => name.startsWith("haben-eric-"));

describe("EricProcessClient mit Stub-Worker", () => {
  it("reicht die Antwort des Workers durch", async () => {
    const result = await stub("answer").validate(xml());
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.responseXml)).toMatchObject({
      config: { ericHome: "/opt/eric" },
      op: "validate",
      datenartVersion: "UStVA_2026",
    });
  });

  it("legt das Zertifikat mit 0600 ab, liest das PDF und räumt auf", async () => {
    const before = ericTempDirs();
    const result = await stub("answer").send(xml(), new Uint8Array([1, 2, 3]), "1234", { test: true });
    expect(result.ok).toBe(true);
    expect(result.transferTicket).toBe("stub-ticket");
    expect(JSON.parse(result.responseXml)).toMatchObject({ op: "send", certMode: 0o600, pinOk: true });
    expect(Buffer.from(result.pdf!).toString()).toBe("%PDF-stub");
    expect(ericTempDirs()).toEqual(before);
  });

  it("meldet Abstürze mit Signal", async () => {
    const before = ericTempDirs();
    const result = await stub("crash").send(xml(), new Uint8Array([1]), "1234", { test: true });
    expect(result).toMatchObject({ ok: false, code: -1 });
    expect(result.message).toMatch(/^ERiC-Prozess abgestürzt \(Signal SIGSEGV\)/);
    expect(ericTempDirs()).toEqual(before);
  });

  it("meldet ein Ende ohne Antwort mit Exit-Code und stderr", async () => {
    const result = await stub("exit").validate(xml());
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Exit-Code 3");
    expect(result.message).toContain("libericapi.so");
  });

  it("reicht Fehler des Workers durch", async () => {
    expect(await stub("error").validate(xml())).toMatchObject({ ok: false, message: "kaputt" });
  });

  it("bricht hängende Prozesse nach dem Timeout ab", async () => {
    const started = Date.now();
    const result = await stub("hang", 500).validate(xml());
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Zeitüberschreitung");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("meldet einen fehlenden Worker", async () => {
    const result = await new EricProcessClient({ ericHome: "/x", workerPath: join(fixtures, "gibt-es-nicht.mjs") }).validate(xml());
    expect(result.ok).toBe(false);
  });

  it("verweigert Senden, wenn Testmerker und Option nicht passen", async () => {
    const client = stub("answer");
    expect((await client.send(xml(false), new Uint8Array([1]), "1234", { test: true })).ok).toBe(false);
    expect((await client.send(xml(true), new Uint8Array([1]), "1234", { test: false })).ok).toBe(false);
  });

  it("verlangt eine Datenart-Version im XML", async () => {
    expect((await stub("answer").validate("<Elster/>")).ok).toBe(false);
  });
});

/** Der echte Worker gegen eine nachgebaute libericapi.so (nur mit C-Compiler). */
function compileMockEric(): string | undefined {
  const home = mkdtempSync(join(tmpdir(), "haben-mock-eric-"));
  mkdirSync(join(home, "lib"));
  try {
    execFileSync("cc", ["-shared", "-fPIC", "-o", join(home, "lib/libericapi.so"), join(fixtures, "mock-eric.c")], {
      stdio: "ignore",
    });
    return home;
  } catch {
    rmSync(home, { recursive: true, force: true });
    return undefined;
  }
}

const mockHome = compileMockEric();
afterAll(() => {
  if (mockHome) rmSync(mockHome, { recursive: true, force: true });
});

describe.skipIf(!mockHome)("EricProcessClient mit Mock-ERiC über koffi", () => {
  const client = () => new EricProcessClient({ ericHome: mockHome!, logDir: mockHome! });

  it("validiert nur mit ERIC_VALIDIERE und ohne Parameterstrukturen", async () => {
    const result = await client().validate(xml());
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Text zu 0 äö");
    expect(result.responseXml).toContain("<V>UStVA_2026</V><F>2</F><D>0:-</D><C>0:0:-</C>");
    expect(result.responseXml).toContain("<TH>(nil)</TH>");
  });

  it("sendet mit Flags, Druck- und Verschlüsselungsparametern", async () => {
    const result = await client().send(xml(), new Uint8Array([1]), "geheim", { test: true });
    expect(result.ok).toBe(true);
    expect(result.responseXml).toMatch(/<F>38<\/F><D>2:[^<]*protokoll\.pdf<\/D><C>3:42:geheim<\/C>/);
    expect(result.transferTicket).toBe("tt-123");
    expect(Buffer.from(result.pdf!).toString()).toBe("%PDF-mock");
  });

  it("sendet Nachrichten mit Transferhandle und ohne Druck", async () => {
    const nachricht = buildNachrichtXml({
      steuernummer13: "9198011310010",
      bundesland: "BY",
      absender: { name: "Testfirma", strasse: "Musterstraße 1", plz: "93047", ort: "Regensburg" },
      betreff: "Test",
      text: "Hallo",
      herstellerId: "74931",
      produktVersion: "0.1.0",
      test: true,
    });
    const result = await client().send(nachricht, new Uint8Array([1]), "geheim", { test: true, print: false });
    expect(result.ok).toBe(true);
    expect(result.responseXml).toMatch(/<V>SonstigeNachrichten_21<\/V><F>6<\/F><D>0:-<\/D><C>3:42:geheim<\/C>/);
    expect(result.responseXml).not.toContain("<TH>(nil)</TH>");
    expect(result.pdf).toBeUndefined();
  });

  it("überlebt einen Segfault in der Bibliothek", async () => {
    const result = await client().validate(xml().replace("<Kz83>", "<Kz83>CRASH"));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Signal SIGSEGV");
  });
});
