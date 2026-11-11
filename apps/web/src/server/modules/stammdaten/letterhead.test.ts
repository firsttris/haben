import { LAYOUT_DOCUMENT_TYPES } from "@haben/core";
import { renderInvoicePdf } from "@haben/einvoice";
import { execFileSync } from "node:child_process";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sampleDocument } from "../../../../../../packages/einvoice/src/samples.ts";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const hasPdftoppm = (() => {
  try {
    execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!testDatabaseUrl)("Briefkopf und Standardprofil (Postgres)", () => {
  let letterhead: typeof import("./letterhead.ts");
  let background: typeof import("./background.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const klassisch = { kind: "eingebaut", id: "klassisch" };

  beforeAll(async () => {
    sql = await setupTestDb();
    letterhead = await import("./letterhead.ts");
    background = await import("./background.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate letterhead_profiles, letterhead_background, company_logo, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
  });

  it("gilt ohne Einstellung das Standardgrün, ohne Logo", async () => {
    const head = await letterhead.loadLetterhead();
    expect(head.accent).toBe("#1F6F5C");
    expect(head).not.toHaveProperty("logo");
    expect(head.options).toMatchObject({ logoSize: "m", logoPosition: "rechts", foldMarks: true });
  });

  it("jede Belegart hat ihr eigenes Layout, ab Werk das eingebaute", async () => {
    const { layouts } = await letterhead.loadDesign();
    expect(Object.keys(layouts).sort()).toEqual([...LAYOUT_DOCUMENT_TYPES].sort());
    for (const type of LAYOUT_DOCUMENT_TYPES) expect(layouts[type]).toEqual(klassisch);
  });

  it("speichert die Farbe groß geschrieben im Standardprofil und protokolliert sie", async () => {
    await letterhead.saveAccentColor(actor, "#0055aa");
    expect((await letterhead.loadLetterhead()).accent).toBe("#0055AA");
    const [log] = await sql`select new_value from audit_log where table_name = 'letterhead_profiles' and action = 'INSERT' order by seq desc limit 1`;
    expect(log!.new_value).toMatchObject({ is_default: true, settings: { accent: "#0055AA" } });
  });

  it("legt beim zweiten Speichern kein weiteres Profil an und behält, was die Eingabe nicht nennt", async () => {
    await letterhead.saveDesign(actor, { accent: "#0055AA", logoSize: "l" });
    await letterhead.saveDesign(actor, { foldMarks: false });
    const rows = await sql`select settings from letterhead_profiles`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.settings).toMatchObject({ layouts: { rechnung: klassisch }, accent: "#0055AA", logoSize: "l", foldMarks: false, giroCode: true });
  });

  it("übergibt Logo und Schalter an das PDF", async () => {
    await letterhead.saveDesign(actor, { logoSize: "s", logoPosition: "links", giroCode: false });
    expect((await letterhead.loadLetterhead()).options).toMatchObject({ logoSize: "s", logoPosition: "links", giroCode: false, customerNumber: true });
  });

  it("verliert bei gleichzeitigem Speichern keine Einstellung", async () => {
    await letterhead.saveDesign(actor, { accent: "#0055AA" });
    for (let i = 0; i < 10; i++) {
      await Promise.all([
        letterhead.saveDesign(actor, { logoSize: i % 2 ? "s" : "l" }),
        letterhead.saveDesign(actor, { foldMarks: i % 2 === 0 }),
        letterhead.saveDesign(actor, { giroCode: i % 2 === 0 }),
      ]);
    }
    expect(await letterhead.loadDesign()).toMatchObject({ accent: "#0055AA", logoSize: "s", foldMarks: false, giroCode: false });
  });

  it("erlaubt nur ein Standardprofil", async () => {
    await letterhead.saveAccentColor(actor, "#0055AA");
    await expect(sql`insert into letterhead_profiles (name, is_default, settings) values ('Zweites', true, '{"accent": "#000000"}'::jsonb)`).rejects.toThrow(
      /letterhead_profiles_default/,
    );
  });

  it("lehnt alles außer #RRGGBB ab, auch direkt in der Datenbank", async () => {
    for (const color of ["blue", "#05A", "#0055AAFF", "0055AA", '#00"); panic('])
      await expect(letterhead.saveAccentColor(actor, color)).rejects.toThrow(/#RRGGBB/);
    await expect(sql`insert into letterhead_profiles (name, settings) values ('Kaputt', '{"accent": "rot"}'::jsonb)`).rejects.toThrow(
      /letterhead_profiles_accent/,
    );
  });

  it("lehnt unbekannte Werte ab und ändert dann nichts", async () => {
    await expect(letterhead.saveDesign(actor, { logoSize: "xl" as "l" })).rejects.toThrow(/ungültig/);
    expect(await sql`select 1 from letterhead_profiles`).toHaveLength(0);
  });

  it("speichert eine eigene Fußzeile und lehnt unbekannte Platzhalter ab", async () => {
    await letterhead.saveDesign(actor, { footerColumns: ["{firma}", "{steuernummer}"] });
    expect((await letterhead.loadLetterhead()).options?.footerColumns).toEqual(["{firma}", "{steuernummer}"]);
    await expect(letterhead.saveDesign(actor, { footerColumns: ["{fax}", "{steuernummer}"] })).rejects.toThrow(/ungültig/);
    await letterhead.saveDesign(actor, { footerColumns: null });
    expect((await letterhead.loadLetterhead()).options?.footerColumns).toBeNull();
  });
  describe("Briefpapier", () => {
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));

    it("gehört nach dem Speichern zum Briefkopf und nennt Format und Prüfsumme", async () => {
      await background.saveBackground(actor, png);
      const head = await letterhead.loadLetterhead();
      expect(head.background?.format).toBe("png");
      expect([...(head.background?.data ?? [])]).toEqual([...png]);
      expect((await background.backgroundInfo())?.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("ersetzt ein vorhandenes Briefpapier", async () => {
      await background.saveBackground(actor, png);
      await background.saveBackground(actor, new Uint8Array([...png, 4]));
      expect((await sql`select count(*)::int as n from letterhead_background`)[0]!.n).toBe(1);
    });

    it.skipIf(!hasPdftoppm)("wandelt die erste Seite eines PDF in ein Bild um", async () => {
      await background.saveBackground(actor, renderInvoicePdf(sampleDocument()));
      const head = await letterhead.loadLetterhead();
      expect(head.background?.format).toBe("png");
      expect([...head.background!.data.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });

    it("lehnt ein beschädigtes PDF ab", async () => {
      await expect(background.saveBackground(actor, new TextEncoder().encode("%PDF-1.7 kaputt"))).rejects.toThrow(/PDF/);
    });

    it("lässt sich entfernen", async () => {
      await background.saveBackground(actor, png);
      await background.removeBackground(actor);
      expect(await letterhead.loadLetterhead()).not.toHaveProperty("background");
    });

    it("lehnt leere, zu große und andere Dateien ab", async () => {
      await expect(background.saveBackground(actor, new Uint8Array())).rejects.toThrow("leer");
      await expect(background.saveBackground(actor, new Uint8Array(background.MAX_BACKGROUND_BYTES + 1).fill(0x89))).rejects.toThrow("2 MB");
      await expect(background.saveBackground(actor, new TextEncoder().encode("GIF89a"))).rejects.toThrow("PNG, JPEG und PDF");
    });

    it("protokolliert die Änderung, aber nicht das Bild", async () => {
      await background.saveBackground(actor, png);
      const [row] = await sql`select new_value from audit_log where table_name = 'letterhead_background' order by id desc limit 1`;
      expect(row!.new_value).toHaveProperty("sha256");
      expect(row!.new_value).not.toHaveProperty("background");
    });
  });
});
