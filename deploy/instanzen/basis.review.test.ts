/**
 * Review #548: Ablage, wenn HABEN_INSTANZEN leer gesetzt ist. Das frühere Bash-Skript nahm dann ~/haben
 * (${HABEN_INSTANZEN:-$HOME/haben}); das Werkzeug nimmt resolve(""), also das aktuelle Verzeichnis.
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import { main } from "./haben-instanzen.ts";
import { umgebung } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
});
afterEach(() => t.aufraeumen());

it("nimmt bei leerem HABEN_INSTANZEN die Vorgabe ~/haben statt des aktuellen Verzeichnisses", async () => {
  // Basis von umgebung() ist <dir>/haben, also genau $HOME/haben mit HOME=<dir>
  expect((await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten")).status).toBe(0);
  const aus: string[] = [];
  const fehler: string[] = [];
  const status = await main(["liste"], {
    vorlagen: "",
    ausfuehren: t.docker.ausfuehren,
    shell: { PATH: "/usr/bin:/bin", HOME: t.dir, HABEN_INSTANZEN: "" },
    abrufen: async () => 200,
    schlafen: async () => {},
    warten: 0,
    takt: 0,
    aus: (z) => aus.push(z),
    fehler: (z) => fehler.push(z),
  });
  expect(status, fehler.join("\n")).toBe(0);
  expect(aus.map((z) => z.split(/\s+/)[0])).toEqual(["firma1"]);
});
