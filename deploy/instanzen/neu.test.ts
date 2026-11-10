/**
 * neu mit nachgebautem docker: getrennte Schlüssel und Namen je Instanz, nichts Vorhandenes überschreiben, Gruppen
 * je Instanz mit SSO (#504). Übernommen aus den Tests des früheren Bash-Skripts.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { envWerte } from "./env-datei.ts";
import { main } from "./haben-instanzen.ts";
import { nachbau, umgebung, VORLAGEN } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
});
afterEach(() => t.aufraeumen());

const env = (name: string) => envWerte(readFileSync(join(t.basis, name, ".env"), "utf8"));
const roh = (name: string) => readFileSync(join(t.basis, name, ".env"), "utf8");

describe("neu", () => {
  it("gibt jeder Instanz eigene Schlüssel, Projektnamen und Backup-Namen", async () => {
    expect((await t.lauf("neu", "firma1", "firma1.example.de")).status).toBe(0);
    expect((await t.lauf("neu", "firma2", "firma2.example.de")).status).toBe(0);
    const [a, b] = [env("firma1"), env("firma2")];
    for (const key of ["DB_PASSWORD", "AUTH_SECRET", "ENCRYPTION_KEY", "RESTIC_PASSWORD"]) {
      expect(a.get(key), key).toMatch(/^[A-Za-z0-9+/=]{32,}$/);
      expect(a.get(key), key).not.toBe(b.get(key));
    }
    expect(a.get("DB_PASSWORD")).toMatch(/^[0-9a-f]{48}$/);
    for (const key of ["AUTH_SECRET", "ENCRYPTION_KEY", "RESTIC_PASSWORD"]) expect(Buffer.from(a.get(key) ?? "", "base64")).toHaveLength(32);
    expect([a.get("COMPOSE_PROJECT_NAME"), b.get("COMPOSE_PROJECT_NAME")]).toEqual(["haben-firma1", "haben-firma2"]);
    expect([a.get("BACKUP_HOST"), b.get("BACKUP_HOST")]).toEqual(["haben-firma1", "haben-firma2"]);
    expect([a.get("DOMAIN"), b.get("DOMAIN")]).toEqual(["firma1.example.de", "firma2.example.de"]);
    expect(statSync(join(t.basis, "firma1", ".env")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(t.basis, "firma2", "compose.override.yml"), "utf8")).toContain("aliases: [haben-firma2]");
    expect(readFileSync(join(t.basis, "proxy", "sites", "firma2.caddy"), "utf8")).toMatch(/^firma2\.example\.de \{[\s\S]*reverse_proxy haben-firma2:3000/);
    // compose.yml unverändert aus deploy/
    expect(readFileSync(join(t.basis, "firma1", "compose.yml"), "utf8")).toBe(readFileSync(join(VORLAGEN, "compose.yml"), "utf8"));
  });

  it("ändert an der .env nur die gesetzten Zeilen, alles andere bleibt Byte für Byte wie in der Vorlage", async () => {
    await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    const vorlage = readFileSync(join(VORLAGEN, "compose.env.example"), "utf8").split("\n");
    const neu = roh("firma1").split("\n");
    const geaendert = vorlage.slice(0, -1).flatMap((z, i) => (neu[i] === z ? [] : [neu[i]?.split("=")[0]]));
    expect(geaendert.sort()).toEqual(["AUTH_SECRET", "DB_PASSWORD", "DOMAIN", "ENCRYPTION_KEY", "RESTIC_PASSWORD"]);
    // In der Vorlage fehlen COMPOSE_PROJECT_NAME und BACKUP_HOST; sie kommen am Ende dazu
    expect(neu.slice(vorlage.length - 1)).toEqual(["COMPOSE_PROJECT_NAME=haben-firma1", "BACKUP_HOST=haben-firma1", ""]);
  });

  it("startet den Proxy vor der Instanz, lädt ihn danach nur neu und nennt den Einrichtungscode", async () => {
    const erste = await t.lauf("neu", "firma1", "firma1.example.de");
    expect(erste.stdout).toContain("Einrichtungscode für https://x/setup: abcd-efgh");
    expect(t.docker.aufrufe.filter((a) => a.includes(" up -d"))).toEqual(["proxy compose up -d", "firma1 compose up -d"]);
    t.docker.z.caddyLaeuft = true;
    await t.lauf("neu", "firma2", "firma2.example.de");
    expect(t.docker.aufrufe).toContain("proxy compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile");
  });

  it("lässt ein vorhandenes Verzeichnis samt .env Byte für Byte unangetastet", async () => {
    mkdirSync(join(t.basis, "firma1"), { recursive: true });
    writeFileSync(join(t.basis, "firma1", ".env"), "ENCRYPTION_KEY=alt\n");
    const r = await t.lauf("neu", "firma1", "firma1.example.de");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("gibt es schon");
    expect(roh("firma1")).toBe("ENCRYPTION_KEY=alt\n");
    expect(readdirSync(join(t.basis, "firma1"))).toEqual([".env"]);
    expect(t.docker.aufrufe).toEqual([]);
  });

  it("lehnt eine Domain ab, die schon einer Instanz gehört", async () => {
    await t.lauf("neu", "firma1", "firma1.example.de");
    const r = await t.lauf("neu", "firma2", "firma1.example.de");
    expect(r.stderr).toContain("gehört schon zur Instanz firma1");
    expect(existsSync(join(t.basis, "firma2"))).toBe(false);
  });

  it.each([
    ["Firma1", "firma1.example.de"],
    ["-x", "firma1.example.de"],
    ["proxy", "proxy.example.de"],
    ["a/b", "firma1.example.de"],
    ["firma1", "https://firma1.example.de"],
    ["firma1", "firma1.example.de/haben"],
    ["firma1", "localhost"],
  ])("lehnt Name %s mit Domain %s ab", async (name, domain) => {
    const r = await t.lauf("neu", name, domain);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/^Fehler: /);
    expect(existsSync(join(t.basis, name))).toBe(false);
    expect(t.docker.aufrufe).toEqual([]);
  });

  it("setzt die Hersteller-ID nur auf ausdrückliche Angabe und nur mit fünf Ziffern wie die App", async () => {
    await t.lauf("neu", "firma1", "firma1.example.de");
    await t.lauf("neu", "firma2", "firma2.example.de", "--hersteller-id", "12345");
    expect(env("firma1").get("ELSTER_HERSTELLER_ID")).toBe("");
    expect(env("firma2").get("ELSTER_HERSTELLER_ID")).toBe("12345");
    const r = await t.lauf("neu", "firma3", "firma3.example.de", "--hersteller-id", "123");
    expect(r.stderr).toContain("fünf Ziffern");
    expect(existsSync(join(t.basis, "firma3"))).toBe(false);
  });

  it("vergibt mit SSO eindeutige Gruppen je Instanz und übernimmt das Secret wörtlich", async () => {
    const sso = (name: string) => [
      "--sso",
      "--oidc-issuer",
      "https://auth.example.de",
      "--oidc-client-id",
      `haben-${name}`,
      "--oidc-client-secret",
      "ge$heim #1",
    ];
    expect((await t.lauf("neu", "firma1", "firma1.example.de", ...sso("firma1"))).status).toBe(0);
    const zweite = await t.lauf("neu", "firma2", "firma2.example.de", ...sso("firma2"));
    expect(zweite.status).toBe(0);
    expect(zweite.stdout).toContain("Gruppen haben-firma2-inhaber und haben-firma2-steuerberatung");
    expect(zweite.stdout).toContain("redirect_uris: [https://firma2.example.de/api/auth/callback/oidc]");
    const [a, b] = [env("firma1"), env("firma2")];
    expect(a.get("OIDC_ONLY")).toBe("true");
    expect([a.get("OIDC_GROUP_INHABER"), a.get("OIDC_GROUP_STEUERBERATUNG")]).toEqual(["haben-firma1-inhaber", "haben-firma1-steuerberatung"]);
    expect([b.get("OIDC_GROUP_INHABER"), b.get("OIDC_GROUP_STEUERBERATUNG")]).toEqual(["haben-firma2-inhaber", "haben-firma2-steuerberatung"]);
    // In einfachen Anführungszeichen ersetzt Compose kein $ und liest # nicht als Kommentar
    expect(roh("firma1")).toContain("OIDC_CLIENT_SECRET='ge$heim #1'\n");
    expect(a.get("OIDC_CLIENT_SECRET")).toBe("ge$heim #1");
    expect(a.get("OIDC_ISSUER")).toBe("https://auth.example.de");
    expect(a.get("OIDC_DISPLAY_NAME")).toBe("Authelia");
  });

  it("verlangt für SSO alle Angaben und nimmt sie nicht ohne --sso", async () => {
    expect((await t.lauf("neu", "firma1", "firma1.example.de", "--sso", "--oidc-issuer", "https://auth.example.de")).stderr).toContain("--sso braucht");
    expect((await t.lauf("neu", "firma1", "firma1.example.de", "--oidc-client-id", "x")).stderr).toContain("nur zusammen mit --sso");
    expect(
      (await t.lauf("neu", "firma1", "firma1.example.de", "--sso", "--oidc-issuer", "https://a.de", "--oidc-client-id", "x", "--oidc-client-secret", "it's"))
        .stderr,
    ).toContain("darf weder");
    expect((await t.lauf("neu", "firma1", "firma1.example.de", "--hersteller-id")).stderr).toContain("--hersteller-id braucht einen Wert");
    expect(existsSync(join(t.basis, "firma1"))).toBe(false);
  });

  it("legt mit --eigener-proxy nur das Netz an und gibt den Block aus", async () => {
    const r = await t.lauf("neu", "firma1", "firma1.example.de", "--eigener-proxy");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("reverse_proxy haben-firma1:3000");
    expect(existsSync(join(t.basis, "proxy"))).toBe(false);
    expect(t.docker.aufrufe).toContain("- network create haben-proxy");
  });

  it("bindet mit --eric-home ein gemeinsames ERiC lesend ein", async () => {
    await t.lauf("neu", "firma1", "firma1.example.de", "--eric-home", "/opt/eric", "--nicht-starten");
    expect(env("firma1").get("ERIC_HOME")).toBe("/opt/eric");
    expect(readFileSync(join(t.basis, "firma1", "compose.override.yml"), "utf8")).toContain("- /opt/eric:/opt/eric:ro");
    // Nur nachgesehen, welche Projekte es gibt; nichts gestartet
    expect(t.docker.aufrufe).toEqual(["- compose ls -a -q", "- volume ls -q --filter label=com.docker.compose.project=haben-firma1"]);
  });

  it("meldet eine App, die nicht gesund wird", async () => {
    t.docker.z.kaputt.add("firma1");
    const r = await t.lauf("neu", "firma1", "firma1.example.de");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Die App von firma1 ist nicht gesund geworden");
  });

  it("lässt nach einem Abbruch beim Anlegen kein halbes Verzeichnis zurück", async () => {
    // Vorlagen ohne compose.env.example: compose.yml ist schon kopiert, dann bricht es ab
    const vorlagen = join(t.dir, "vorlagen");
    mkdirSync(vorlagen);
    cpSync(join(VORLAGEN, "compose.yml"), join(vorlagen, "compose.yml"));
    const docker = nachbau();
    const fehler: string[] = [];
    const status = await main(["--basis", t.basis, "neu", "firma1", "firma1.example.de", "--nicht-starten"], {
      vorlagen,
      ausfuehren: docker.ausfuehren,
      shell: { PATH: "/usr/bin" },
      abrufen: async () => 200,
      schlafen: async () => {},
      warten: 3,
      takt: 0,
      aus: () => {},
      fehler: (z) => fehler.push(z),
    });
    expect(status).toBe(1);
    expect(fehler.join("\n")).toMatch(/^Fehler: .*compose\.env\.example/);
    expect(readdirSync(t.basis)).toEqual([]);
    rmSync(vorlagen, { recursive: true });
  });
});
