/**
 * Beitragsprüfung #548: Das Clientsecret kommt aus einer Datei oder von der Standardeingabe, nicht als Argument und
 * nicht aus der Umgebung. Ein Argument steht in der Prozessliste und in der Shell-Historie; docs/installation.md,
 * „Zurück zum Standardmodus“, verlangt für Betreiberbefehle: „Kein Passwort in Kommandozeilenargumente,
 * Shell-Historie oder Logs schreiben.“
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { envWerte } from "./env-datei.ts";
import { abbrechen } from "./kontext.ts";
import { umgebung } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
});
afterEach(() => t.aufraeumen());

const sso = ["--sso", "--oidc-issuer", "https://auth.example.de", "--oidc-client-id", "haben-firma1"];
const env = () => envWerte(readFileSync(join(t.basis, "firma1", ".env"), "utf8"));
const neu = (...args: string[]) => t.lauf("neu", "firma1", "firma1.example.de", ...sso, ...args, "--nicht-starten");

function datei(inhalt: string): string {
  const pfad = join(t.dir, "clientsecret");
  writeFileSync(pfad, inhalt, { mode: 0o600 });
  return pfad;
}

it("liest das Clientsecret aus einer Datei, ohne den Zeilenumbruch am Ende, und gibt es nicht aus", async () => {
  const r = await neu("--oidc-client-secret-file", datei("ge$heim #1\n"));
  expect(r.status, r.stderr).toBe(0);
  expect(env().get("OIDC_CLIENT_SECRET")).toBe("ge$heim #1");
  expect(r.stdout + r.stderr).not.toContain("ge$heim");
});

it("liest das Clientsecret von der Standardeingabe", async () => {
  t.eingabe("ge$heim #2\n");
  const r = await neu("--oidc-client-secret-stdin");
  expect(r.status, r.stderr).toBe(0);
  expect(env().get("OIDC_CLIENT_SECRET")).toBe("ge$heim #2");
  expect(r.stdout + r.stderr).not.toContain("ge$heim");
});

it("nimmt das Clientsecret nicht aus der Umgebung: Eine noch gesetzte Variable gälte unbemerkt für die nächste Instanz", async () => {
  t.shell({ OIDC_CLIENT_SECRET: "aus-der-shell" });
  const r = await neu();
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("--sso braucht das Clientsecret");
  expect((await t.lauf("liste")).stdout).toBe("");
});

it("meldet Strg+C bei der verdeckten Eingabe als Abbruch und legt nichts an", async () => {
  t.eingabe(() => abbrechen("Abgebrochen."));
  const r = await neu("--oidc-client-secret-stdin");
  expect(r.status).toBe(1);
  expect(r.stderr).toBe("Fehler: Abgebrochen.");
  expect((await t.lauf("liste")).stdout).toBe("");
});

it("nimmt das Clientsecret nicht als Argument an", async () => {
  const r = await neu("--oidc-client-secret", "ge$heim");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("Unbekannte Option: --oidc-client-secret");
  expect(r.stderr).not.toContain("ge$heim");
});

it("verlangt genau eine Quelle", async () => {
  expect((await neu()).stderr).toContain("--sso braucht das Clientsecret");
  t.eingabe("aus-der-eingabe\n");
  const r = await neu("--oidc-client-secret-file", datei("aus-der-datei\n"), "--oidc-client-secret-stdin");
  expect(r.stderr).toContain("nur aus einer Quelle");
  expect(r.stderr).not.toContain("aus-der");
  expect((await t.lauf("liste")).stdout).toBe("");
});

it("legt nichts an, wenn die Quelle fehlt, leer ist oder das Secret sich nicht in die .env schreiben lässt", async () => {
  expect((await neu("--oidc-client-secret-file", join(t.dir, "fehlt"))).stderr).toContain("lässt sich nicht lesen");
  expect((await neu("--oidc-client-secret-file", datei("\n"))).stderr).toContain("ist leer");
  expect((await neu("--oidc-client-secret-stdin")).stderr).toContain("die Standardeingabe lässt sich nicht lesen");
  t.eingabe("");
  expect((await neu("--oidc-client-secret-stdin")).stderr).toContain("ist leer");
  const r = await neu("--oidc-client-secret-file", datei("zwei\nZeilen\n"));
  expect(r.stderr).toContain("darf weder");
  expect(r.stderr).not.toContain("zwei");
  expect((await t.lauf("liste")).stdout).toBe("");
});
