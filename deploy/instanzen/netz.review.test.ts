/**
 * Aus dem TDD-Review zu #872: Das Netz einer Instanz hinter dem gemeinsamen Caddy legt Compose im Projekt des Caddy
 * an, und der Caddy hängt darin, solange es in proxy/compose.override.yml steht. `docker network rm` allein scheitert
 * dann („has active endpoints“).
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { umgebung } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
});
afterEach(() => t.aufraeumen());

describe("neu nach einem abgebrochenen neu desselben Namens", () => {
  it("nennt vor docker network rm, wie der gemeinsame Caddy aus dem Netz kommt", async () => {
    t.docker.z.dbKaputt.add("firma1");
    expect((await t.lauf("neu", "firma1", "firma1.example.de")).status).toBe(1);
    // docker compose up -d in proxy/ hat das Netz angelegt, der Caddy hängt darin
    t.docker.z.netze.add("haben-proxy-firma1");
    // Aufgeräumt wie nach einem Fehlversuch üblich: docker compose down -v, Verzeichnis gelöscht
    rmSync(join(t.basis, "firma1"), { recursive: true });
    t.docker.z.dbKaputt.clear();

    const r = await t.lauf("neu", "firma1", "firma1.example.de");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Das Netz haben-proxy-firma1 gibt es schon");
    const override = r.stderr.indexOf(join(t.basis, "proxy", "compose.override.yml"));
    const up = r.stderr.indexOf(`cd ${join(t.basis, "proxy")} && docker compose up -d`);
    const rm = r.stderr.indexOf("docker network rm haben-proxy-firma1");
    expect(override).toBeGreaterThan(-1);
    expect(up).toBeGreaterThan(override);
    expect(rm).toBeGreaterThan(up);
    expect(existsSync(join(t.basis, "firma1"))).toBe(false);
  });
});
