import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEInvoice, startvorlage } from "@haben/einvoice";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sampleDocument } from "../../../../../../packages/einvoice/src/samples.ts";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const hasPoppler = spawnSync("pdftotext", ["-v"]).status === 0;

function pdfText(pdf: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "haben-layout-test-"));
  try {
    writeFileSync(join(dir, "b.pdf"), pdf);
    return execFileSync("pdftotext", [join(dir, "b.pdf"), "-"], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Die eingebaute Vorlage mit einem Erkennungszeichen auf dem Blatt */
const eigene = (art: "beleg" | "mahnung", zeichen = "EIGENES LAYOUT") => `${startvorlage(art)}\n#place(top + left, dx: 5mm, dy: 5mm, text(8pt)[${zeichen}])\n`;

describe.skipIf(!testDatabaseUrl || !hasPoppler)("Eigene Belegvorlagen (Postgres)", () => {
  let layouts: typeof import("./layouts.ts");
  let letterhead: typeof import("./letterhead.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    layouts = await import("./layouts.ts");
    letterhead = await import("./letterhead.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate beleg_layouts, letterhead_profiles cascade`;
  });

  it("speichert ein gültiges Layout mit Version des Feldvertrags und im Änderungsprotokoll", async () => {
    const { id } = await layouts.createLayout(actor, { name: "Mein Layout", art: "beleg", source: eigene("beleg") });
    const [row] = await sql`select name, art, schema_version, packages from beleg_layouts where id = ${id}`;
    expect(row).toMatchObject({ name: "Mein Layout", art: "beleg", schema_version: 1, packages: [] });
    const [audit] = await sql`select actor, action from audit_log where table_name = 'beleg_layouts' and row_id = ${id}`;
    expect(audit).toMatchObject({ actor, action: "INSERT" });
  }, 60_000);

  it("lehnt ein Layout ohne Pflichtangaben ab und speichert nichts", async () => {
    await expect(layouts.createLayout(actor, { name: "Leer", art: "beleg", source: "#let d = json(bytes(sys.inputs.data))\n= #d.title" })).rejects.toThrow(
      /Es fehlt .*Anschrift des Empfängers/,
    );
    expect(await sql`select 1 from beleg_layouts`).toHaveLength(0);
  }, 60_000);

  it("meldet Fehler von Typst mit Zeile", async () => {
    await expect(layouts.createLayout(actor, { name: "Kaputt", art: "beleg", source: "#let d = 1\n#nichtda" })).rejects.toThrow(
      /Zeile 2: unknown variable: nichtda/,
    );
  }, 60_000);

  it("bricht eine zu lange Vorlage nach dem Zeitlimit ab", async () => {
    await expect(layouts.createLayout(actor, { name: "Lang", art: "beleg", source: "#{ for i in range(4000000000) { } }" })).rejects.toThrow(/Zeitlimit/);
  }, 60_000);

  it("lehnt Pakete aus dem Netz ab, solange es keine Freigabe gibt", async () => {
    await expect(layouts.createLayout(actor, { name: "Paket", art: "beleg", source: `#import "@preview/cetz:0.3.4"\n${eigene("beleg")}` })).rejects.toThrow(
      /@preview\/cetz:0\.3\.4/,
    );
  });

  it("verlangt eindeutige Namen", async () => {
    await layouts.createLayout(actor, { name: "Doppelt", art: "mahnung", source: eigene("mahnung") });
    await expect(layouts.createLayout(actor, { name: " Doppelt ", art: "mahnung", source: eigene("mahnung") })).rejects.toThrow(/schon ein Layout/);
  }, 60_000);

  it("ordnet ein Layout zu und setzt den Beleg damit, ohne eingebaute Vorlage", async () => {
    const { id } = await layouts.createLayout(actor, { name: "Rechnungslayout", art: "beleg", source: eigene("beleg") });
    await layouts.assignLayout(actor, "rechnung", { kind: "eigen", id });
    expect((await letterhead.loadDesign()).layouts.rechnung).toEqual({ kind: "eigen", id });
    expect((await letterhead.loadDesign()).layouts.angebot).toEqual({ kind: "eingebaut", id: "klassisch" });
    const { pdf, xml } = await layouts.withCustomLayout("rechnung", {}, (lh) => buildEInvoice({ ...sampleDocument(), ...lh }));
    expect(pdfText(pdf)).toContain("EIGENES LAYOUT");
    // Das XML hängt Haben weiter an, auch an ein eigenes Layout
    expect(Buffer.from(pdf).toString("latin1")).toContain("factur-x.xml");
    expect(xml).toContain("2026-034");
  }, 60_000);

  it("passt die Art nicht, wird nichts zugeordnet", async () => {
    const { id } = await layouts.createLayout(actor, { name: "Mahnlayout", art: "mahnung", source: eigene("mahnung") });
    await expect(layouts.assignLayout(actor, "rechnung", { kind: "eigen", id })).rejects.toThrow(/nur zu Mahnungen/);
  }, 60_000);

  it("löscht ein Layout und setzt die Zuordnung auf das eingebaute zurück", async () => {
    const { id } = await layouts.createLayout(actor, { name: "Weg", art: "beleg", source: eigene("beleg") });
    await layouts.assignLayout(actor, "angebot", { kind: "eigen", id });
    await layouts.deleteLayout(actor, id);
    expect((await letterhead.loadDesign()).layouts.angebot).toEqual({ kind: "eingebaut", id: "klassisch" });
  }, 60_000);

  it("fällt beim Setzen nicht still auf das eingebaute zurück", async () => {
    const { id } = await layouts.createLayout(actor, { name: "Bricht", art: "beleg", source: eigene("beleg") });
    await layouts.assignLayout(actor, "rechnung", { kind: "eigen", id });
    // Wie ein Layout, das nach einem Update von Typst nicht mehr setzt
    await sql`update beleg_layouts set source = '#nichtda' where id = ${id}`;
    await expect(layouts.withCustomLayout("rechnung", {}, (lh) => buildEInvoice({ ...sampleDocument(), ...lh }))).rejects.toThrow(
      /Layout „Bricht“ ließ sich nicht setzen.*ein anderes wählen/,
    );
  }, 60_000);

  it("benennt um und ersetzt den Quelltext nach erneuter Prüfung", async () => {
    const { id } = await layouts.createLayout(actor, { name: "Alt", art: "beleg", source: eigene("beleg") });
    await layouts.renameLayout(actor, id, "Neu");
    await layouts.replaceLayoutSource(actor, id, eigene("beleg", "ZWEITE FASSUNG"));
    await expect(layouts.replaceLayoutSource(actor, id, "#nichtda")).rejects.toThrow(/Zeile 1/);
    const [row] = await sql`select name, source from beleg_layouts where id = ${id}`;
    expect(row!.name).toBe("Neu");
    expect(row!.source).toContain("ZWEITE FASSUNG");
  }, 60_000);
});
