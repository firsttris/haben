/**
 * Trennung der Firmen vor `neu`: kein Projekt, keine Volumes, kein Alias und keine Domain, die schon jemand anderem
 * gehören. Übernommen aus den Review-Runden des früheren Bash-Skripts (#548).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { umgebung } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
});
afterEach(() => t.aufraeumen());

/** Ohne Verzeichnis und ohne Start von firma1 */
async function abgelehnt(...args: string[]) {
  const r = await t.lauf("neu", ...args);
  expect(r.status, r.stdout).not.toBe(0);
  expect(existsSync(join(t.basis, args[0] ?? ""))).toBe(false);
  expect(t.docker.aufrufe.some((a) => a.includes(" up "))).toBe(false);
  return r;
}

function vonHand(dir: string, env: string) {
  mkdirSync(join(t.basis, dir), { recursive: true });
  writeFileSync(join(t.basis, dir, "compose.yml"), "");
  writeFileSync(join(t.basis, dir, ".env"), env);
}

it("lehnt einen Namen ab, dessen Compose-Projekt docker schon kennt", async () => {
  t.docker.z.projekte = ["haben", "haben-firma1"];
  expect((await abgelehnt("firma1", "firma1.example.de")).stderr).toContain("Docker kennt schon ein Compose-Projekt haben-firma1");
});

it("lehnt einen Namen ab, dessen Projekt nur noch als Volumes besteht (nach docker compose down)", async () => {
  // Von Hand angelegte Instanz außerhalb der Basis nach docker compose down: keine Container, also nicht in
  // compose ls -a, aber die Volumes mit Datenbank und Belegen der Firma sind noch da
  t.docker.z.volumen = ["haben-firma1_db", "haben-firma1_belege", "haben-firma1_backups"];
  expect((await abgelehnt("firma1", "firma1.example.de")).stderr).toContain("Es gibt schon Volumes des Compose-Projekts haben-firma1 (haben-firma1_db");
});

it("legt keine Instanz an, wenn docker nicht sagen kann, ob es Projekt oder Volumes schon gibt", async () => {
  // Etwa ohne Rechte am Docker-Socket oder bei gestopptem Daemon: ein späteres up übernähme übrig gebliebene Volumes
  t.docker.z.tot = true;
  expect((await abgelehnt("firma1", "firma1.example.de", "--nicht-starten")).stderr).toContain("docker antwortet nicht");
});

it("lehnt einen Namen ab, dessen Projekt und Alias schon eine von Hand angelegte Instanz trägt", async () => {
  // Von Hand nach der Doku: Verzeichnis haben-firma1, COMPOSE_PROJECT_NAME=haben-firma1, Alias haben-firma1
  vonHand("haben-firma1", "COMPOSE_PROJECT_NAME=haben-firma1\nDOMAIN=alt.example.de\n");
  expect((await abgelehnt("firma1", "firma1.example.de")).stderr).toContain("Das Compose-Projekt haben-firma1 gehört schon zur Instanz");
});

it("erkennt das Projekt einer von Hand angelegten Instanz auch mit Kommentar am Zeilenende", async () => {
  // Compose liest COMPOSE_PROJECT_NAME=haben-firma1 # Firma 1 als haben-firma1
  vonHand("haben-firma1", "COMPOSE_PROJECT_NAME=haben-firma1 # Firma 1\nDOMAIN=alt.example.de\n");
  await abgelehnt("firma1", "firma1.example.de", "--nicht-starten");
});

it("erkennt die Domain einer von Hand angelegten Instanz auch in doppelten Anführungszeichen", async () => {
  vonHand("haben-alt", 'COMPOSE_PROJECT_NAME=haben-alt\nDOMAIN="alt.example.de"\n');
  expect((await abgelehnt("firma1", "alt.example.de", "--nicht-starten")).stderr).toContain("gehört schon zur Instanz haben-alt");
});

it("lehnt eine Domain ab, für die im gemeinsamen Caddy schon ein Eintrag steht", async () => {
  // Übrig nach dem Löschen einer Instanz (Verzeichnis entfernt, proxy/sites/alt.caddy nicht): zwei Blöcke für
  // dieselbe Domain lehnt Caddy ab (ambiguous site definition); reload scheitert, ein Neustart des Proxys auch
  mkdirSync(join(t.basis, "proxy", "sites"), { recursive: true });
  writeFileSync(join(t.basis, "proxy", "sites", "alt.caddy"), "firma1.example.de {\n\treverse_proxy haben-alt:3000\n}\n");
  expect((await abgelehnt("firma1", "firma1.example.de", "--nicht-starten")).stderr).toContain("steht schon ein Eintrag im gemeinsamen Caddy");
});

it("vergibt keinen Alias, der im Netz haben-proxy schon der Containername einer anderen Instanz ist", async () => {
  // Die App von firma1 heißt im Netz haben-proxy auch haben-firma1-app-1; der Alias von firma1-app-1 wäre derselbe
  expect((await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten")).status).toBe(0);
  await abgelehnt("firma1-app-1", "x.example.de", "--nicht-starten");
});

it.each([
  // compose.yml heißt ohne COMPOSE_PROJECT_NAME haben; deren App heißt haben-app-1 und hängt mit der Override-Datei
  // aus der Doku im Netz des Proxys
  ["app-1", "gleicht dem Containernamen des Standardprojekts haben"],
  ["app", "ist der Alias haben-app einer einzelnen Instanz nach compose.override.example.yml"],
  ["firma1-", "endet auf - (haben-firma1- ist kein gültiger Hostname für reverse_proxy)"],
  ["db-2", "gleicht einem Containernamen"],
  ["a".repeat(32), "ist länger als 31 Zeichen"],
])("lehnt den Namen %s ab: %s", async (name) => {
  await abgelehnt(name, "x.example.de", "--nicht-starten");
  expect(t.docker.aufrufe).toEqual([]);
});
