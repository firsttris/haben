import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dunningAmounts } from "@haben/core";
import { buildDeliveryNotePdf, buildDunningPdf, buildEInvoice, LAYOUT_PFLICHTFELDER, startvorlage } from "@haben/einvoice";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { gmbhSeller, sampleBuyer, sampleDocument, sampleSeller } from "../../../../../../packages/einvoice/src/samples.ts";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { fakeUniverse, paketArchiv, tarEintrag } from "./test-paket.ts";

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

/** Typst Universe im Test: @preview/demo in zwei Versionen, 0.3.0 braucht @preview/hilfe */
const demoLib = "#let marke() = text(8pt)[AUS DEM PAKET]";
const universum = (extra: Record<string, Buffer> = {}) =>
  fakeUniverse({
    "@preview/demo:0.1.0": paketArchiv("demo", "0.1.0", demoLib),
    "@preview/demo:0.2.0": paketArchiv("demo", "0.2.0", demoLib),
    "@preview/demo:0.3.0": paketArchiv("demo", "0.3.0", `#import "@preview/hilfe:1.0.0": x\n${demoLib}`),
    "@preview/hilfe:1.0.0": paketArchiv("hilfe", "1.0.0", "#let x = 1"),
    ...extra,
  });

/** Am Ende eines Probe-Quelltexts: nennt alle Pflichtfelder, damit die Prüfung bis zum Setzen kommt; Zeilennummern bleiben */
const FELDER = `\n// ${LAYOUT_PFLICHTFELDER.beleg.join(" ").replaceAll("|", " ")}`;

/** Die eingebaute Vorlage mit einem Erkennungszeichen auf dem Blatt */
const eigene = (art: "beleg" | "mahnung", zeichen = "EIGENES LAYOUT") => `${startvorlage(art)}\n#place(top + left, dx: 5mm, dy: 5mm, text(8pt)[${zeichen}])\n`;

const mitPaket = `#import "@preview/demo:0.1.0": marke\n${eigene("beleg")}\n#marke()\n`;

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

  /** Legt an und verlangt, dass es ohne Rückfrage geht */
  async function anlegen(input: Parameters<typeof layouts.createLayout>[1], deps?: Parameters<typeof layouts.createLayout>[2]) {
    const result = await layouts.createLayout(actor, input, deps);
    if (!("id" in result)) throw new Error(`Rückfrage statt Anlegen: ${result.needsApproval.join()}`);
    return result;
  }

  it("speichert ein gültiges Layout mit Version des Feldvertrags und im Änderungsprotokoll", async () => {
    const { id } = await anlegen({ name: "Mein Layout", art: "beleg", source: eigene("beleg") });
    const [row] = await sql`select name, art, schema_version, packages from beleg_layouts where id = ${id}`;
    expect(row).toMatchObject({ name: "Mein Layout", art: "beleg", schema_version: 1, packages: [] });
    const [audit] = await sql`select actor, action from audit_log where table_name = 'beleg_layouts' and row_id = ${id}`;
    expect(audit).toMatchObject({ actor, action: "INSERT" });
  }, 60_000);

  it("lehnt ein Layout ohne Pflichtangaben ab und speichert nichts", async () => {
    await expect(anlegen({ name: "Leer", art: "beleg", source: `#let d = json(bytes(sys.inputs.data))\n= #d.title${FELDER}` })).rejects.toThrow(
      /Es fehlt .*Anschrift des Empfängers/,
    );
    expect(await sql`select 1 from beleg_layouts`).toHaveLength(0);
  }, 60_000);

  it("meldet Fehler von Typst mit Zeile", async () => {
    await expect(anlegen({ name: "Kaputt", art: "beleg", source: `#let d = 1\n#nichtda${FELDER}` })).rejects.toThrow(/Zeile 2: unknown variable: nichtda/);
  }, 60_000);

  it("bricht eine zu lange Vorlage nach dem Zeitlimit ab", async () => {
    await expect(anlegen({ name: "Lang", art: "beleg", source: `#{ for i in range(4000000000) { } }${FELDER}` })).rejects.toThrow(/Zeitlimit/);
  }, 60_000);

  it("fragt bei Paketen erst nach und speichert nichts ohne Freigabe", async () => {
    const vorlagen = join(process.env.DOCUMENTS_DIR!, "vorlagen");
    const vorher = existsSync(vorlagen) ? readdirSync(vorlagen) : [];
    const result = await layouts.createLayout(actor, { name: "Paket", art: "beleg", source: mitPaket }, { fetch: universum() });
    expect(result).toEqual({ needsApproval: ["@preview/demo:0.1.0"] });
    expect(await sql`select 1 from beleg_layouts`).toHaveLength(0);
    expect(existsSync(vorlagen) ? readdirSync(vorlagen) : []).toEqual(vorher);
  });

  it("nennt in der Rückfrage auch die Abhängigkeiten und verlangt die Freigabe aller", async () => {
    const source = mitPaket.replaceAll("demo:0.1.0", "demo:0.3.0");
    const fetch = universum();
    const alle = ["@preview/demo:0.3.0", "@preview/hilfe:1.0.0"];
    expect(await layouts.createLayout(actor, { name: "Tief", art: "beleg", source }, { fetch })).toEqual({ needsApproval: alle });
    expect(await layouts.createLayout(actor, { name: "Tief", art: "beleg", source, approve: ["@preview/demo:0.3.0"] }, { fetch })).toEqual({
      needsApproval: alle,
    });
    const { id } = await anlegen({ name: "Tief", art: "beleg", source, approve: alle }, { fetch });
    const [row] = await sql`select packages from beleg_layouts where id = ${id}`;
    expect(row?.packages).toEqual([
      { name: "@preview/demo", version: "0.3.0" },
      { name: "@preview/hilfe", version: "1.0.0" },
    ]);
  }, 60_000);

  it("lädt freigegebene Pakete in den Cache des Layouts und setzt danach ohne Netz", async () => {
    const { id } = await anlegen({ name: "Mit Paket", art: "beleg", source: mitPaket, approve: ["@preview/demo:0.1.0"] }, { fetch: universum() });
    const [row] = await sql`select packages, approved_sha256 = sha256 as frei from beleg_layouts where id = ${id}`;
    expect(row).toMatchObject({ packages: [{ name: "@preview/demo", version: "0.1.0" }], frei: true });
    await layouts.assignLayout(actor, "rechnung", { kind: "eigen", id });
    const { pdf } = await layouts.withCustomLayout("rechnung", {}, (lh) => buildEInvoice({ ...sampleDocument(), ...lh }));
    expect(pdfText(pdf)).toContain("AUS DEM PAKET");
  }, 60_000);

  it("ein zusammengesetzter Paketname findet den Cache eines anderen Layouts nicht", async () => {
    await anlegen({ name: "Hat Paket", art: "beleg", source: mitPaket, approve: ["@preview/demo:0.1.0"] }, { fetch: universum() });
    // Ohne erkennbaren Import gibt es keine Rückfrage und keinen Cache; das Setzen scheitert ohne Netz
    const versteckt = mitPaket.replace('#import "@preview/demo:0.1.0"', '#import "@preview/" + "demo:0.1.0"');
    await expect(anlegen({ name: "Versteckt", art: "beleg", source: versteckt })).rejects.toThrow(
      /Paket @preview\/demo:0\.1\.0 ist nicht freigegeben oder fehlt im Cache/,
    );
  }, 60_000);

  it("meldet einen fehlenden Cache und lädt nur auf Zuruf nach", async () => {
    const { id } = await anlegen({ name: "Restore", art: "beleg", source: mitPaket, approve: ["@preview/demo:0.1.0"] }, { fetch: universum() });
    rmSync(join(process.env.DOCUMENTS_DIR!, "vorlagen", id, "pakete"), { recursive: true, force: true });
    expect((await layouts.listLayouts()).find((l) => l.id === id)?.packagesMissing).toBe(true);
    await layouts.reloadPackages(id, { fetch: universum() });
    expect((await layouts.listLayouts()).find((l) => l.id === id)?.packagesMissing).toBe(false);
  }, 60_000);

  it("ein geänderter Quelltext fragt neu", async () => {
    const fetch = universum();
    const { id } = await anlegen({ name: "Ändern", art: "beleg", source: mitPaket, approve: ["@preview/demo:0.1.0"] }, { fetch });
    const anders = mitPaket.replaceAll("demo:0.1.0", "demo:0.2.0");
    expect(await layouts.replaceLayoutSource(actor, id, anders, ["@preview/demo:0.1.0"], { fetch })).toEqual({
      needsApproval: ["@preview/demo:0.2.0"],
    });
  }, 60_000);

  it("ein abgelehnter neuer Quelltext lässt das bisherige Layout samt Paketen setzbar", async () => {
    const fetch = universum();
    const { id } = await anlegen({ name: "Bleibt nutzbar", art: "beleg", source: mitPaket, approve: ["@preview/demo:0.1.0"] }, { fetch });
    await layouts.assignLayout(actor, "rechnung", { kind: "eigen", id });
    await expect(layouts.replaceLayoutSource(actor, id, `#nichtda${FELDER}`, undefined, { fetch })).rejects.toThrow(/Zeile 1/);
    expect((await layouts.listLayouts()).find((l) => l.id === id)?.packagesMissing).toBe(false);
    const { pdf } = await layouts.withCustomLayout("rechnung", {}, (lh) => buildEInvoice({ ...sampleDocument(), ...lh }));
    expect(pdfText(pdf)).toContain("AUS DEM PAKET");
  }, 60_000);

  it("hält die Höchstzahl des Betreibers ein (LAYOUTS_MAX_COUNT)", async () => {
    const limits = { maxCount: 1 };
    await anlegen({ name: "Eins", art: "mahnung", source: eigene("mahnung") }, { limits });
    await expect(anlegen({ name: "Zwei", art: "mahnung", source: eigene("mahnung") }, { limits })).rejects.toThrow(/mehr erlaubt diese Installation nicht/);
  }, 60_000);

  it("hält den Speicher des Betreibers ein, mit Paketen (LAYOUTS_MAX_MB)", async () => {
    const quelltext = Buffer.byteLength(eigene("mahnung"), "utf8");
    const limits = { maxBytes: quelltext * 2 + 1000 };
    const { id } = await anlegen({ name: "Platz eins", art: "mahnung", source: eigene("mahnung") }, { limits });
    // Ersetzen zählt das alte Layout nicht doppelt
    await layouts.replaceLayoutSource(actor, id, eigene("mahnung", "NEU"), undefined, { limits });
    await anlegen({ name: "Platz zwei", art: "mahnung", source: eigene("mahnung") }, { limits });
    await expect(anlegen({ name: "Platz drei", art: "mahnung", source: eigene("mahnung") }, { limits })).rejects.toThrow(/höchstens 1 MB frei/);
    // Pakete zählen mit: Ein großer Download macht das Layout zu groß, und es bleibt nichts liegen
    await sql`truncate beleg_layouts`;
    const gross = universum({ "@preview/demo:0.1.0": paketArchiv("demo", "0.1.0", demoLib, [tarEintrag("./ballast.bin", Buffer.alloc(quelltext * 3))]) });
    await expect(
      anlegen({ name: "Zu groß", art: "beleg", source: mitPaket, approve: ["@preview/demo:0.1.0"] }, { fetch: gross, limits: { maxBytes: quelltext * 3 } }),
    ).rejects.toThrow(/frei, mit diesem Layout wären es mehr/);
    expect(await sql`select 1 from beleg_layouts`).toHaveLength(0);
  }, 60_000);

  it("räumt beim Start Ordner ohne Layout weg und lässt die übrigen stehen", async () => {
    const { id } = await anlegen({ name: "Bleibt", art: "mahnung", source: eigene("mahnung") });
    const vorlagen = join(process.env.DOCUMENTS_DIR!, "vorlagen");
    const verwaist = join(vorlagen, crypto.randomUUID());
    mkdirSync(join(verwaist, "pakete"), { recursive: true });
    expect(await layouts.removeOrphanWorkspaces()).toContain(verwaist.split("/").pop());
    expect(existsSync(verwaist)).toBe(false);
    expect(existsSync(join(vorlagen, id))).toBe(true);
  }, 60_000);

  it("lehnt ein Layout ab, das ein Pflichtfeld nicht nennt, bevor es setzt", async () => {
    const ohne = eigene("beleg").replace(/(?<![A-Za-z0-9_])taxNote(?![A-Za-z0-9_])/g, "hinweis");
    await expect(anlegen({ name: "Ohne Hinweis", art: "beleg", source: ohne })).rejects.toThrow(/verwendet diese Pflichtfelder nicht: taxNote/);
    expect(await sql`select 1 from beleg_layouts`).toHaveLength(0);
  });

  it("verlangt eindeutige Namen", async () => {
    await anlegen({ name: "Doppelt", art: "mahnung", source: eigene("mahnung") });
    await expect(anlegen({ name: " Doppelt ", art: "mahnung", source: eigene("mahnung") })).rejects.toThrow(/schon ein Layout/);
  }, 60_000);

  it("ordnet ein Layout zu und setzt den Beleg damit, ohne eingebaute Vorlage", async () => {
    const { id } = await anlegen({ name: "Rechnungslayout", art: "beleg", source: eigene("beleg") });
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
    const { id } = await anlegen({ name: "Mahnlayout", art: "mahnung", source: eigene("mahnung") });
    await expect(layouts.assignLayout(actor, "rechnung", { kind: "eigen", id })).rejects.toThrow(/nur zu Mahnungen/);
  }, 60_000);

  it("löscht ein Layout und setzt die Zuordnung auf das eingebaute zurück", async () => {
    const { id } = await anlegen({ name: "Weg", art: "beleg", source: eigene("beleg") });
    await layouts.assignLayout(actor, "angebot", { kind: "eigen", id });
    await layouts.deleteLayout(actor, id);
    expect((await letterhead.loadDesign()).layouts.angebot).toEqual({ kind: "eingebaut", id: "klassisch" });
  }, 60_000);

  it("fällt beim Setzen nicht still auf das eingebaute zurück", async () => {
    const { id } = await anlegen({ name: "Bricht", art: "beleg", source: eigene("beleg") });
    await layouts.assignLayout(actor, "rechnung", { kind: "eigen", id });
    // Wie ein Layout, das nach einem Update von Typst nicht mehr setzt
    await sql`update beleg_layouts set source = '#nichtda' where id = ${id}`;
    await expect(layouts.withCustomLayout("rechnung", {}, (lh) => buildEInvoice({ ...sampleDocument(), ...lh }))).rejects.toThrow(
      /Layout „Bricht“ ließ sich nicht setzen.*ein anderes wählen/,
    );
  }, 60_000);

  it("benennt um und ersetzt den Quelltext nach erneuter Prüfung", async () => {
    const { id } = await anlegen({ name: "Alt", art: "beleg", source: eigene("beleg") });
    await layouts.renameLayout(actor, id, "Neu");
    await layouts.replaceLayoutSource(actor, id, eigene("beleg", "ZWEITE FASSUNG"));
    await expect(layouts.replaceLayoutSource(actor, id, `#nichtda${FELDER}`)).rejects.toThrow(/Zeile 1/);
    const [row] = await sql`select name, source from beleg_layouts where id = ${id}`;
    expect(row!.name).toBe("Neu");
    expect(row!.source).toContain("ZWEITE FASSUNG");
  }, 60_000);
  it("zwei gleichzeitige Ersetzungen hinterlassen ein Layout, dessen Pakete zum Quelltext passen", async () => {
    const fetch = universum();
    const { id } = await anlegen({ name: "Zweimal", art: "beleg", source: mitPaket, approve: ["@preview/demo:0.1.0"] }, { fetch });
    await layouts.assignLayout(actor, "rechnung", { kind: "eigen", id });
    const a = mitPaket.replaceAll("demo:0.1.0", "demo:0.2.0").replace("EIGENES LAYOUT", "FASSUNG A");
    const b = mitPaket.replaceAll("demo:0.1.0", "demo:0.3.0").replace("EIGENES LAYOUT", "FASSUNG B");
    const ergebnisse = await Promise.allSettled([
      layouts.replaceLayoutSource(actor, id, a, ["@preview/demo:0.2.0"], { fetch }),
      layouts.replaceLayoutSource(actor, id, b, ["@preview/demo:0.3.0", "@preview/hilfe:1.0.0"], { fetch }),
    ]);
    expect(ergebnisse.map((e) => (e.status === "fulfilled" ? "ok" : String(e.reason).slice(0, 200)))).toContain("ok");
    expect((await layouts.listLayouts()).find((l) => l.id === id)?.packagesMissing).toBe(false);
    const { pdf } = await layouts.withCustomLayout("rechnung", {}, (lh) => buildEInvoice({ ...sampleDocument(), ...lh }));
    expect(pdfText(pdf)).toMatch(/FASSUNG [AB]/);
  }, 60_000);

  it("setzt Lieferschein und Mahnung mit dem eigenen Layout", async () => {
    const beleg = await anlegen({ name: "Für Lieferscheine", art: "beleg", source: eigene("beleg", "EIGENER LIEFERSCHEIN") });
    const mahnung = await anlegen({ name: "Für Mahnungen", art: "mahnung", source: eigene("mahnung", "EIGENE MAHNUNG") });
    await layouts.assignLayout(actor, "lieferschein", { kind: "eigen", id: beleg.id });
    await layouts.assignLayout(actor, "mahnung", { kind: "eigen", id: mahnung.id });
    const lieferschein = await layouts.withCustomLayout("lieferschein", {}, (lh) =>
      buildDeliveryNotePdf({
        reference: { kind: "rechnung", number: "2026-034", issueDate: "2026-10-02" },
        deliveryDate: "2026-10-01",
        date: "2026-10-01",
        seller: sampleSeller,
        buyer: sampleBuyer,
        lines: [{ position: 1, description: "Gerät", quantity: 2000, unit: "Stk." }],
        ...lh,
      }),
    );
    expect(pdfText(lieferschein)).toContain("EIGENER LIEFERSCHEIN");
    const doc = {
      level: 1 as const,
      date: "2026-10-16",
      dueDate: "2026-10-26",
      seller: gmbhSeller,
      buyer: sampleBuyer,
      invoice: { number: "2026-034", issueDate: "2026-09-02", dueDate: "2026-09-16" },
      intro: "leider ist die Rechnung offen.",
      closing: "Danke.",
      amounts: dunningAmounts({ open: 100_000, dueDate: "2026-09-16", date: "2026-10-16", fee: 0, flatFee: false, interestRate: 0 }),
    };
    const pdf = await layouts.withCustomLayout("mahnung", {}, (lh) => buildDunningPdf({ ...doc, ...lh } as Parameters<typeof buildDunningPdf>[0]));
    expect(pdfText(pdf)).toContain("EIGENE MAHNUNG");
  }, 60_000);
});
