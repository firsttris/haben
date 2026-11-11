import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pdfData, templateInputs } from "./pdf.ts";
import { createRenderClient, renderWorkerEnv } from "./render-client.ts";
import { sampleDocument } from "./samples.ts";
import { PACKAGE_DIR } from "./typst-compiler.ts";

const templates = join(PACKAGE_DIR, "templates");
const workspace = mkdtempSync(join(tmpdir(), "haben-render-test-"));
const client = createRenderClient({ timeoutMs: 3_000 });

afterAll(() => {
  client.close();
  rmSync(workspace, { recursive: true, force: true });
});

function vorlage(name: string, source: string) {
  writeFileSync(join(workspace, name), source);
  return { workspace, main: join(workspace, name), data: {}, files: [] };
}

describe("Render-Prozess", () => {
  it("setzt die Rechnungsvorlage als SVG mit Seitenzahl und Maßen", async () => {
    const data = templateInputs(pdfData(sampleDocument({})), {});
    const sheet = await client.render({ workspace: templates, main: join(templates, "rechnung.typ"), data, files: [] });
    expect(sheet.svg.startsWith("<svg")).toBe(true);
    expect(sheet.pages).toBe(1);
    expect(sheet.width).toBeCloseTo(596, 0);
    expect(sheet.height).toBeCloseTo(842, 0);
    expect(sheet.ms).toBeGreaterThanOrEqual(0);
  });

  it("zählt bei mehreren Seiten jede Seite und teilt die Höhe auf", async () => {
    const data = templateInputs(pdfData(sampleDocument({})), {}) as { lines: object[] };
    const lines = Array.from({ length: 60 }, (_, i) => ({ ...data.lines[0], pos: String(i + 1) }));
    const sheet = await client.render({ workspace: templates, main: join(templates, "rechnung.typ"), data: { ...data, lines }, files: [] });
    expect(sheet.pages).toBeGreaterThan(1);
    expect(sheet.height).toBeCloseTo(842, 0);
  });

  it("setzt dieselbe Vorlage auch als PDF/A-3b", async () => {
    const data = templateInputs(pdfData(sampleDocument({})), {});
    const pdf = await client.renderPdf({ workspace: templates, main: join(templates, "rechnung.typ"), data, files: [] }, "2026-10-02");
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(Buffer.from(pdf).toString("latin1")).toContain("pdfaid:part");
  });

  it("reicht Dateien nur für diesen Lauf an die Vorlage", async () => {
    const job = vorlage("datei.typ", '#read("notiz.txt")');
    await expect(client.render({ ...job, files: [{ name: "notiz.txt", base64: Buffer.from("hallo").toString("base64") }] })).resolves.toMatchObject({
      pages: 1,
    });
    await expect(client.render(job)).rejects.toThrow(/notiz\.txt|not found/i);
  });

  it("beendet eine zu lange Vorlage hart und rendert danach weiter", async () => {
    const lang = vorlage("lang.typ", "#{ for i in range(4000000000) { } }");
    await expect(client.render(lang)).rejects.toThrow(/Zeitlimit/);
    await expect(client.render(vorlage("kurz.typ", "Hallo"))).resolves.toMatchObject({ pages: 1 });
  }, 15_000);

  it("arbeitet Aufträge hinter einem abgebrochenen ab", async () => {
    const lang = client.render(vorlage("lang2.typ", "#{ for i in range(4000000000) { } }"));
    const danach = client.render(vorlage("danach.typ", "Danach"));
    await expect(lang).rejects.toThrow(/Zeitlimit/);
    await expect(danach).resolves.toMatchObject({ pages: 1 });
  }, 15_000);

  it("liest keine Datei außerhalb der Projektwurzel", async () => {
    await expect(client.render(vorlage("passwd.typ", '#read("/etc/passwd")'))).rejects.toThrow();
    await expect(client.render(vorlage("hoch.typ", '#read("../geheim.txt")'))).rejects.toThrow();
  });

  it("lädt keine Pakete aus dem Netz und scheitert schnell", async () => {
    const started = Date.now();
    await expect(client.render(vorlage("paket.typ", '#import "@preview/cetz:0.3.4"'))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it("meldet einen Fehler in der Vorlage, ohne den Prozess zu verlieren", async () => {
    await expect(client.render(vorlage("kaputt.typ", "#nichtda"))).rejects.toThrow(/nichtda/);
    await expect(client.render(vorlage("gut.typ", "Gut"))).resolves.toMatchObject({ pages: 1 });
  });
});

describe("Umgebung des Render-Prozesses", () => {
  it("vererbt keine Geheimnisse der App und sperrt das Netz", () => {
    process.env.DATABASE_URL = "postgres://geheim";
    process.env.MASTER_KEY = "geheim";
    const env = renderWorkerEnv();
    expect(Object.keys(env)).not.toContain("DATABASE_URL");
    expect(Object.keys(env)).not.toContain("MASTER_KEY");
    expect(Object.values(env).join()).not.toContain("geheim");
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:9");
    expect(env.https_proxy).toBe("http://127.0.0.1:9");
  });
});

describe("Ende ohne Aufträge", () => {
  it("startet nach der Leerlaufzeit bei Bedarf neu", async () => {
    const kurz = createRenderClient({ idleMs: 50 });
    await kurz.render(vorlage("eins.typ", "Eins"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(kurz.render(vorlage("zwei.typ", "Zwei"))).resolves.toMatchObject({ pages: 1 });
    kurz.close();
  });
});
