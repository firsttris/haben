import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Zeichen in der Navigation (Postgres)", () => {
  let navMark: typeof import("./nav-mark.ts");
  let logo: typeof import("./logo.ts");
  let letterhead: typeof import("./letterhead.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const png = new Uint8Array(readFileSync(new URL("../../../../public/icon-192.png", import.meta.url)));

  beforeAll(async () => {
    sql = await setupTestDb();
    navMark = await import("./nav-mark.ts");
    logo = await import("./logo.ts");
    letterhead = await import("./letterhead.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate company_logo, letterhead_profiles, company cascade`;
  });

  it("ab Werk gilt das „H“ des Themes", async () => {
    expect(await navMark.loadNavMark()).toEqual({ color: null, logo: false });
  });

  it("speichert eine eigene Farbe in Großbuchstaben, ins Änderungsprotokoll, und „Standard“ löscht sie", async () => {
    await navMark.saveNavMark(actor, { art: "farbe", farbe: "#1d4ed8" });
    expect(await navMark.loadNavMark()).toEqual({ color: "#1D4ED8", logo: false });
    const [eintrag] = await sql`select new_value from audit_log where table_name = 'company' and action = 'UPDATE' order by id desc limit 1`;
    expect(eintrag!.new_value).toMatchObject({ nav_color: "#1D4ED8", nav_logo: false });
    await navMark.saveNavMark(actor, { art: "standard" });
    expect(await navMark.loadNavMark()).toEqual({ color: null, logo: false });
  });

  it("lehnt eine Farbe ab, die nicht #RRGGBB ist, und ändert dann nichts", async () => {
    await navMark.saveNavMark(actor, { art: "farbe", farbe: "#1D4ED8" });
    for (const farbe of ["1D4ED8", "#1D4ED", "#GGGGGG", "red", ""]) {
      await expect(navMark.saveNavMark(actor, { art: "farbe", farbe })).rejects.toThrow(/#RRGGBB/);
    }
    expect(await navMark.loadNavMark()).toEqual({ color: "#1D4ED8", logo: false });
    // Auch an der Anwendung vorbei hält die Datenbank die Form
    await expect(sql`update company set nav_color = '#1d4ed8' where id = 1`).rejects.toThrow(/company_nav_color/);
  });

  it("das Logo nur, wenn es eins gibt; die Farbe bleibt dabei für später erhalten", async () => {
    await navMark.saveNavMark(actor, { art: "farbe", farbe: "#B5462F" });
    await expect(navMark.saveNavMark(actor, { art: "logo" })).rejects.toThrow(/noch kein Logo/);
    expect(await navMark.loadNavMark()).toEqual({ color: "#B5462F", logo: false });
    await logo.saveLogo(actor, png);
    await navMark.saveNavMark(actor, { art: "logo" });
    expect(await navMark.loadNavMark()).toEqual({ color: "#B5462F", logo: true });
    await navMark.saveNavMark(actor, { art: "farbe", farbe: "#B5462F" });
    expect(await navMark.loadNavMark()).toEqual({ color: "#B5462F", logo: false });
  });

  it("hängt nicht an der Beleggestaltung: die Akzentfarbe der Belege ändert das Zeichen nicht und umgekehrt", async () => {
    await navMark.saveNavMark(actor, { art: "farbe", farbe: "#1D4ED8" });
    await letterhead.saveAccentColor(actor, "#B5462F");
    expect(await navMark.loadNavMark()).toEqual({ color: "#1D4ED8", logo: false });
    await navMark.saveNavMark(actor, { art: "standard" });
    expect((await letterhead.loadDesign()).accent).toBe("#B5462F");
  });
});
