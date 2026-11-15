import { describe, expect, it } from "vitest";
import { bunAusfuehren, umgebungFuerDocker } from "./ausfuehren.ts";

describe("Umgebung für docker", () => {
  it("lässt nur PATH, HOME und die DOCKER-Variablen des Clients durch", () => {
    const shell = {
      PATH: "/bin",
      HOME: "/home/x",
      DOCKER_HOST: "tcp://h:2376",
      DOCKER_CONTEXT: "c",
      DOCKER_CONFIG: "/d",
      COMPOSE_PROJECT_NAME: "haben-firma1",
      COMPOSE_FILE: "compose.yml",
      ENCRYPTION_KEY: "fremd",
      DOMAIN: "firma1.example.de",
      USER: "x",
    };
    expect(umgebungFuerDocker(shell)).toEqual({ PATH: "/bin", HOME: "/home/x", DOCKER_HOST: "tcp://h:2376", DOCKER_CONTEXT: "c", DOCKER_CONFIG: "/d" });
  });
});

describe("bunAusfuehren", () => {
  it("gibt dem Befehl genau die übergebene Umgebung, nicht die des Prozesses", async () => {
    process.env.HABEN_INSTANZEN_TEST_GEHEIM = "geheim";
    try {
      const r = await bunAusfuehren(["/bin/sh", "-c", 'test -z "$HABEN_INSTANZEN_TEST_GEHEIM" && echo "leer|$A|$PWD"; echo fehler >&2; exit 3'], {
        cwd: "/",
        env: { A: "1" },
      });
      expect(r).toEqual({ code: 3, stdout: "leer|1|/\n", stderr: "fehler\n" });
    } finally {
      delete process.env.HABEN_INSTANZEN_TEST_GEHEIM;
    }
  });

  it("gibt eingabe an die Standardeingabe des Befehls und schließt sie danach", async () => {
    const r = await bunAusfuehren(["/bin/cat"], { cwd: "/", env: {}, eingabe: "ge$heim\nge$heim\n" });
    expect(r).toEqual({ code: 0, stdout: "ge$heim\nge$heim\n", stderr: "" });
  });

  it("gibt mit binaer die Bytes unverändert zurück, auch solche, die kein UTF-8 sind", async () => {
    const r = await bunAusfuehren(["/bin/sh", "-c", "printf '\\211PNG\\377\\000\\001'"], { cwd: "/", env: {}, binaer: true });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.daten).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0x01]));
  });

  it("meldet ein fehlendes Programm mit Code 127", async () => {
    expect((await bunAusfuehren(["haben-gibt-es-nicht"], { cwd: "/", env: { PATH: "/nirgends" } })).code).toBe(127);
  });
});
