/**
 * Review #548: Erreichbarkeit in status. Vor der Einrichtung leitet die App /login nach /setup weiter
 * (apps/web/src/routes/login.tsx, beforeLoad); abgerufen wird ohne Weiterleitungen, die Antwort ist also 3xx.
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import { main } from "./haben-instanzen.ts";
import { umgebung } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
});
afterEach(() => t.aufraeumen());

it("zeigt eine frisch angelegte, gesunde Instanz, deren /login nach /setup weiterleitet, als erreichbar", async () => {
  expect((await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten")).status).toBe(0);
  const aus: string[] = [];
  await main(["--basis", t.basis, "status"], {
    vorlagen: "",
    ausfuehren: t.docker.ausfuehren,
    shell: {},
    // Noch nicht eingerichtet: /login antwortet mit einer Weiterleitung nach /setup
    abrufen: async (url) => (url.endsWith("/login") ? 307 : 200),
    schlafen: async () => {},
    warten: 0,
    takt: 0,
    aus: (z) => aus.push(z),
    fehler: () => {},
  });
  expect(aus[1]).toMatch(/^firma1\s+firma1\.example\.de\s+9\.9\.9\s+ja\s/);
});
