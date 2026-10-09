import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { buildNachrichtXml } from "./nachricht.ts";
import { buildPostfachAnfrageXml, buildPostfachBestaetigungXml } from "./postfach.ts";
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

  it("legt die ERiC-Logs ohne ERIC_LOG_DIR ins Temp-Verzeichnis des Aufrufs, das danach gelöscht wird", async () => {
    const before = ericTempDirs();
    const result = await stub("answer").validate(xml());
    const { logDir } = JSON.parse(result.responseXml).config as { logDir: string };
    expect(logDir.startsWith(join(tmpdir(), "haben-eric-"))).toBe(true);
    expect(existsSync(logDir)).toBe(false);
    expect(ericTempDirs()).toEqual(before);
    const fest = new EricProcessClient({ ericHome: "/opt/eric", logDir: "/var/log/eric", workerPath: join(fixtures, "worker-answer.mjs") });
    expect(JSON.parse((await fest.validate(xml())).responseXml).config.logDir).toBe("/var/log/eric");
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

  it("verwirft eine schon eingetroffene Antwort nicht, wenn der Prozess danach hängt", async () => {
    const result = await stub("answer-hang", 500).validate(xml());
    expect(result).toMatchObject({ ok: true, transferTicket: "stub-ticket" });
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
    execFileSync("cc", ["-shared", "-fPIC", "-o", join(home, "lib/libotto.so"), join(fixtures, "mock-otto.c")], {
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
    expect(result.responseXml).toMatch(/<F>38<\/F><D>4:[^<]*protokoll\.pdf<\/D><C>3:42:geheim<\/C>/);
    expect(result.transferTicket).toBe("tt-123");
    expect(Buffer.from(result.pdf!).toString()).toBe("%PDF-mock");
  });

  it("sendet Nachrichten ohne Transferhandle und ohne Druck", async () => {
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
    expect(result.responseXml).toContain("<TH>(nil)</TH>");
    expect(result.pdf).toBeUndefined();
  });

  it("fragt das Postfach ab und lädt die Anhänge über Otto, Fehler je Datei", async () => {
    const anfrage = buildPostfachAnfrageXml({ datenlieferant: "Test", herstellerId: "74931", produktVersion: "0.1.0", test: true });
    const result = await client().fetchPostfach(anfrage, new Uint8Array([1]), "geheim", { test: true, herstellerId: "74931" });
    expect(result.ok).toBe(true);
    expect(result.responseXml).toMatch(/<V>PostfachAnfrage_31<\/V><F>6<\/F><D>0:-<\/D><C>3:42:geheim<\/C>/);
    expect(result.responseXml).not.toContain("<TH>(nil)</TH>");
    expect(result.bereitstellungen).toEqual([
      expect.objectContaining({ id: "b-1", datenart: "DivaBescheidESt", veranlagungszeitraum: "2025", anhaenge: expect.any(Array) }),
    ]);
    const [ok, fehlt] = result.dateien;
    expect(ok!.referenzId).toBe("ref-1");
    expect(Buffer.from(ok!.inhalt!).toString("latin1")).toBe("%PDF\0ref-1|12|geheim|74931");
    expect(fehlt).toEqual({ referenzId: "fehlt", fehler: "Otto-Fehler 610: Objekt nicht gefunden" });
  });

  it("bestätigt die Abholung mit Transferhandle", async () => {
    const xml = buildPostfachBestaetigungXml(["b-1"], { datenlieferant: "Test", herstellerId: "74931", produktVersion: "0.1.0", test: true });
    const result = await client().send(xml, new Uint8Array([1]), "geheim", { test: true, print: false });
    expect(result.responseXml).toContain("<V>PostfachBestaetigung_31</V>");
    expect(result.responseXml).not.toContain("<TH>(nil)</TH>");
  });

  it("holt Belege: Liste, Abholung mit Transferhandle, Entschlüsselung je Beleg", async () => {
    const input = { idnr: "02293417683", veranlagungsjahr: 2025, datenlieferant: "Test", herstellerId: "74931", test: true };
    const result = await client().fetchBelege(input, new Uint8Array([1]), "geheim");
    expect(result.ok).toBe(true);
    expect(result.responseXml).toMatch(/<V>ElsterVaStDaten_31<\/V><F>6<\/F><D>0:-<\/D><C>3:42:geheim<\/C>/);
    expect(result.responseXml).not.toContain("<TH>(nil)</TH>");
    expect(result.requestXml).toContain("<Anfrage ");
    expect(result.liste.map((b) => [b.id, b.belegart])).toEqual([
      ["a-1", "VaSt_RBM"],
      ["a-2", "VaSt_KRV"],
      ["a-3", "VaSt_LStB"],
    ]);
    expect(result.abholung!.requestXml).toContain('<Abholung id="a-3"');
    expect(result.abholung!.serverResponseXml).toContain("<TH>ja</TH><N>1</N>");
    const [a1, a2, a3] = result.belege;
    expect(a1!.xml).toContain("<Info>42:geheim:QUJDREVG</Info>");
    expect(a2).toEqual({ id: "a-2", fehler: "Text zu 610301200 äö" });
    expect(a3).toEqual({ id: "a-3", fehler: "Beleg nicht in der Antwort enthalten." });
  });

  it("überlebt einen Segfault in der Bibliothek", async () => {
    const result = await client().validate(xml().replace("<Kz83>", "<Kz83>CRASH"));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Signal SIGSEGV");
  });
});
