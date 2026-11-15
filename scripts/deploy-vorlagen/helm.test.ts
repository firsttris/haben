// Das Helm-Chart (deploy/helm) beschreibt denselben Stack wie deploy/compose.yml. Gerendert mit `helm template`; ohne
// helm übersprungen (docs/entwicklung.md, Tests), der Runner der CI bringt es mit.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

type Env = { name: string; value?: string; valueFrom?: { secretKeyRef: { name: string; key: string } } };
type Mount = { name: string; mountPath: string; readOnly?: boolean };
type Container = {
  name: string;
  image: string;
  command?: string[];
  args?: string[];
  env?: Env[];
  envFrom?: { secretRef: { name: string } }[];
  securityContext?: Record<string, unknown>;
  volumeMounts?: Mount[];
};
type Pod = {
  containers: Container[];
  initContainers?: Container[];
  volumes: { name: string; emptyDir?: { medium?: string }; persistentVolumeClaim?: { claimName: string } }[];
};
type Manifest = {
  kind: string;
  metadata: { name: string; annotations?: Record<string, string> };
  stringData?: Record<string, string>;
  data?: Record<string, string>;
  spec: {
    replicas?: number;
    volumeClaimTemplates?: unknown[];
    strategy?: { type: string };
    template: { spec: Pod };
    rules: { filters: { responseHeaderModifier: { set: { name: string; value: string }[] } }[]; timeouts: { request: string } }[];
  };
};
type Werte = Record<string, unknown>;

const root = join(import.meta.dirname, "../..");
const helm = spawnSync("helm", ["version"], { encoding: "utf8" });

const basis: Werte = {
  domain: "haben.example.de",
  image: { tag: "0.9.0" },
  app: { secretEnv: { BETTER_AUTH_SECRET: "test-auth-secret-mit-mindestens-32-zeichen", HABEN_ENCRYPTION_KEY: "dGVzdA==" } },
  postgresql: { password: "eigentuemer1", appPassword: "app2" },
  backup: { secretEnv: { RESTIC_PASSWORD: "restic3" } },
};
const extern: Werte = {
  ...basis,
  app: { secretEnv: { ...(basis.app as { secretEnv: object }).secretEnv, DATABASE_URL: "postgres://haben_app:x@pooler:5432/haben?max_lifetime=60" } },
  postgresql: { enabled: false },
  backup: { secretEnv: { RESTIC_PASSWORD: "restic3", PGPASSWORD: "eigentuemer1" }, env: { PGHOST: "haben-rw" } },
};

const rendern = (werte: Werte) =>
  spawnSync("helm", ["template", "haben", join(root, "deploy/helm"), "-f", "-"], { input: JSON.stringify(werte), encoding: "utf8" });
const manifeste = (werte: Werte) => {
  const lauf = rendern(werte);
  expect(lauf.stderr).toBe("");
  return (Bun.YAML.parse(lauf.stdout) as (Manifest | null)[]).filter((m): m is Manifest => m !== null);
};
const finde = (liste: Manifest[], kind: string, name: string) => {
  const manifest = liste.find((m) => m.kind === kind && m.metadata.name === name);
  if (!manifest) throw new Error(`${kind} ${name} fehlt`);
  return manifest;
};
const container = (pod: Pod, name: string) => {
  const c = pod.containers.find((x) => x.name === name);
  if (!c) throw new Error(`Container ${name} fehlt`);
  return c;
};
const variable = (c: Container, name: string) => c.env?.find((e) => e.name === name);
const ohneTag = (image: string) => image.replace(/^docker\.io\//, "").replace(/:[^/]*$/, "");

type ComposeService = { image: string; volumes?: string[]; read_only?: boolean; cap_drop?: string[]; tmpfs?: string[] };
const compose = (Bun.YAML.parse(readFileSync(join(root, "deploy/compose.yml"), "utf8")) as { services: Record<string, ComposeService> }).services;

describe.skipIf(helm.status !== 0)("deploy/helm", () => {
  // Erst im Test rendern: Den Rumpf von describe führt Vitest auch aus, wenn er übersprungen wird
  let standard: Manifest[] | undefined;
  const liste = () => {
    standard ??= manifeste(basis);
    return standard;
  };
  const appPod = () => finde(liste(), "Deployment", "haben").spec.template.spec;

  test("nutzt dieselben Images wie deploy/compose.yml, alle in der Version aus image.tag", () => {
    const app = appPod();
    const db = finde(liste(), "StatefulSet", "haben-db").spec.template.spec;
    const images = { app: container(app, "app").image, backup: container(app, "backup").image, db: container(db, "db").image };
    for (const [name, image] of Object.entries(images)) expect(ohneTag(image)).toBe(ohneTag(compose[name].image));
    for (const image of [...Object.values(images), app.initContainers?.[0].image]) expect(image?.endsWith(":0.9.0")).toBe(true);
  });

  // Ein zurückgenommenes Update darf die Datenbank nicht auf die alte PostgreSQL-Version zurücksetzen
  test("hält die Datenbank mit postgresql.tag auf einer anderen Version als die App", () => {
    const alle = manifeste({ ...basis, image: { tag: "0.8.2" }, postgresql: { ...(basis.postgresql as object), tag: "0.9.0" } });
    const app = finde(alle, "Deployment", "haben").spec.template.spec;
    expect(container(finde(alle, "StatefulSet", "haben-db").spec.template.spec, "db").image).toBe("docker.io/tristanteu/haben-db:0.9.0");
    expect(app.initContainers?.[0].image).toBe("docker.io/tristanteu/haben-db:0.9.0");
    expect(container(app, "app").image).toBe("docker.io/tristanteu/haben:0.8.2");
    expect(container(app, "backup").image).toBe("docker.io/tristanteu/haben-backup:0.8.2");
  });

  test("hängt dieselben Verzeichnisse der App ein und härtet sie wie deploy/compose.yml", () => {
    const c = container(appPod(), "app");
    const ziele = (c.volumeMounts ?? []).map((m) => m.mountPath);
    const composeZiele = (compose.app.volumes ?? []).map((v) => v.split(":")[1]).filter((z) => z.startsWith("/var/lib/haben"));
    expect(ziele.filter((z) => z.startsWith("/var/lib/haben")).sort()).toEqual(composeZiele.sort());
    expect(compose.app.read_only).toBe(true);
    expect(c.securityContext).toMatchObject({
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      runAsUser: 1000,
    });
    expect(ziele).toContain("/tmp");
    // Compose hängt /tmp als tmpfs ein; dort liegt während eines Aufrufs von ERiC das ELSTER-Zertifikat
    expect(compose.app.tmpfs).toEqual(["/tmp"]);
    expect(appPod().volumes.find((v) => v.name === "tmp")?.emptyDir).toEqual({ medium: "Memory" });
  });

  test("läuft mit einem Container und ersetzt ihn erst nach dem Ende des alten", () => {
    const deployment = finde(liste(), "Deployment", "haben");
    expect(deployment.spec.replicas).toBe(1);
    expect(deployment.spec.strategy?.type).toBe("Recreate");
  });

  test("trennt Eigentümer und App-Rolle der eigenen Datenbank", () => {
    const secret = finde(liste(), "Secret", "haben-app").stringData ?? {};
    expect(secret.DATABASE_URL).toBe("postgres://haben_app:app2@haben-db:5432/haben");
    expect(secret.MIGRATION_DATABASE_URL).toBe("postgres://haben:eigentuemer1@haben-db:5432/haben");
    expect(finde(liste(), "Secret", "haben-db").stringData).toEqual({ POSTGRES_PASSWORD: "eigentuemer1", APP_PASSWORD: "app2" });
    const init = finde(liste(), "ConfigMap", "haben-db-init").data?.["app-rolle.sh"] ?? "";
    expect(init).toContain("CREATE ROLE haben_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE");
    // Das Passwort kommt als psql-Variable aus der Umgebung, nicht in den Text der ConfigMap
    expect(init).not.toContain("app2");
  });

  test("gibt dem Backup weder die Schlüssel der App noch der App das Passwort des Backups", () => {
    const app = appPod();
    const backup = container(app, "backup");
    expect(backup.envFrom?.map((e) => e.secretRef.name)).toEqual(["haben-backup"]);
    expect(variable(backup, "PGPASSWORD")?.valueFrom?.secretKeyRef).toEqual({ name: "haben-db", key: "POSTGRES_PASSWORD" });
    expect(variable(backup, "PGHOST")?.value).toBe("haben-db");
    expect(container(app, "app").envFrom?.map((e) => e.secretRef.name)).toEqual(["haben-app"]);
    expect(finde(liste(), "Secret", "haben-backup").stringData).toEqual({ RESTIC_PASSWORD: "restic3" });
    expect(backup.volumeMounts).toContainEqual({ name: "belege", mountPath: "/belege", readOnly: true });
  });

  test("setzt BETTER_AUTH_URL aus der Domain und übrige Variablen unverändert", () => {
    const werte = { ...basis, app: { ...(basis.app as object), env: { HABEN_SCHEDULER: "off", ELSTER_HERSTELLER_ID: "01234" } } };
    const c = container(finde(manifeste(werte), "Deployment", "haben").spec.template.spec, "app");
    expect(variable(c, "BETTER_AUTH_URL")?.value).toBe("https://haben.example.de");
    expect(variable(c, "HABEN_SCHEDULER")?.value).toBe("off");
    expect(variable(c, "ELSTER_HERSTELLER_ID")?.value).toBe("01234");
  });

  test("behält Belege, Datenbank und Backup bei helm uninstall", () => {
    for (const name of ["haben-belege", "haben-db", "haben-backups"])
      expect(finde(liste(), "PersistentVolumeClaim", name).metadata.annotations?.["helm.sh/resource-policy"]).toBe("keep");
    // volumeClaimTemplates ließen sich später nicht mehr vergrößern
    const db = finde(liste(), "StatefulSet", "haben-db").spec;
    expect(db.volumeClaimTemplates).toBeUndefined();
    expect(db.template.spec.volumes.find((v) => v.name === "data")?.persistentVolumeClaim?.claimName).toBe("haben-db");
  });

  test("schaltet zum Wiederherstellen die App ab und hängt die Belege schreibbar ein", () => {
    const restore = manifeste({ ...basis, restore: { enabled: true } });
    expect(finde(restore, "Deployment", "haben").spec.replicas).toBe(0);
    const pod = finde(restore, "Deployment", "haben-restore").spec.template.spec;
    expect(container(pod, "restore").volumeMounts).toContainEqual({ name: "belege", mountPath: "/belege" });
    expect(container(pod, "restore").envFrom?.map((e) => e.secretRef.name)).toEqual(["haben-backup"]);
  });

  test("setzt am HTTPRoute dieselben Sicherheits-Header wie das Caddyfile und wartet 300 Sekunden", () => {
    const route = finde(manifeste({ ...basis, httpRoute: { enabled: true, parentRefs: [{ name: "gw" }] } }), "HTTPRoute", "haben");
    const header = Object.fromEntries(route.spec.rules[0].filters[0].responseHeaderModifier.set.map((h) => [h.name, h.value]));
    const caddy = readFileSync(join(root, "deploy/Caddyfile"), "utf8");
    for (const [name, wert] of Object.entries(header)) expect(caddy).toContain(`${name} ${wert.includes(" ") ? `"${wert}"` : wert}`);
    expect(header["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(route.spec.rules[0].timeouts.request).toBe("300s");
  });

  test("nimmt mit externer Datenbank die Zugänge aus den Werten und legt keine Datenbank an", () => {
    const alle = manifeste(extern);
    expect(alle.some((m) => m.kind === "StatefulSet" || m.metadata.name === "haben-db")).toBe(false);
    const pod = finde(alle, "Deployment", "haben").spec.template.spec;
    expect(pod.initContainers).toBeUndefined();
    expect(finde(alle, "Secret", "haben-app").stringData?.DATABASE_URL).toContain("?max_lifetime=60");
    expect(variable(container(pod, "backup"), "PGHOST")?.value).toBe("haben-rw");
    expect(variable(container(pod, "backup"), "PGPASSWORD")).toBeUndefined();
  });

  test("legt mit vorhandenen Secrets keine eigenen an", () => {
    const alle = manifeste({
      domain: "haben.example.de",
      image: basis.image,
      app: { existingSecret: "a" },
      postgresql: { existingSecret: "d" },
      backup: { existingSecret: "b" },
    });
    expect(alle.filter((m) => m.kind === "Secret")).toEqual([]);
    const pod = finde(alle, "Deployment", "haben").spec.template.spec;
    expect(container(pod, "app").envFrom?.[0].secretRef.name).toBe("a");
    expect(variable(container(pod, "backup"), "PGPASSWORD")?.valueFrom?.secretKeyRef.name).toBe("d");
  });

  test.each([
    { fall: "ohne Domain", werte: { ...basis, domain: "" }, meldung: "domain fehlt" },
    { fall: "ohne Version", werte: { ...basis, image: {} }, meldung: "image.tag fehlt" },
    { fall: "mit der Version als Zahl", werte: { ...basis, image: { tag: 0.1 } }, meldung: "image.tag in Anführungszeichen" },
    {
      fall: "mit einer Variablen als Zahl",
      werte: { ...basis, app: { ...(basis.app as object), env: { LAYOUTS_MAX_MB: 50 } } },
      meldung: "app.env.LAYOUTS_MAX_MB in Anführungszeichen",
    },
    {
      fall: "mit off als false",
      werte: { ...basis, app: { ...(basis.app as object), env: { HABEN_SCHEDULER: false } } },
      meldung: "app.env.HABEN_SCHEDULER in Anführungszeichen",
    },
    {
      fall: "mit falscher Uhrzeit des Backups",
      werte: { ...basis, backup: { ...(basis.backup as object), env: { BACKUP_TIME: "3:15" } } },
      meldung: "backup.env.BACKUP_TIME braucht",
    },
    { fall: "mit HTTPRoute ohne Gateway", werte: { ...basis, httpRoute: { enabled: true } }, meldung: "httpRoute.parentRefs fehlt" },
    { fall: "ohne Schlüssel", werte: { ...basis, app: { secretEnv: { BETTER_AUTH_SECRET: "x" } } }, meldung: "app.secretEnv.HABEN_ENCRYPTION_KEY fehlt" },
    {
      fall: "mit Sonderzeichen im Passwort",
      werte: { ...basis, postgresql: { password: "a@b", appPassword: "c" } },
      meldung: "postgresql.password fehlt oder enthält",
    },
    { fall: "ohne Passwort des Backups", werte: { ...basis, backup: { secretEnv: {} } }, meldung: "backup.secretEnv.RESTIC_PASSWORD fehlt" },
    {
      fall: "ohne Eigentümer für das Backup bei externer Datenbank",
      werte: { ...extern, backup: { secretEnv: { RESTIC_PASSWORD: "r" } } },
      meldung: "backup.secretEnv.PGPASSWORD fehlt",
    },
    { fall: "ohne DATABASE_URL bei externer Datenbank", werte: { ...extern, app: basis.app }, meldung: "app.secretEnv.DATABASE_URL fehlt" },
    {
      fall: "mit postgresql.existingSecret ohne app.existingSecret",
      werte: { ...basis, postgresql: { existingSecret: "d" } },
      meldung: "app.existingSecret mit DATABASE_URL",
    },
  ])("bricht $fall mit Meldung ab", ({ werte, meldung }) => {
    const lauf = rendern(werte);
    expect(lauf.status).not.toBe(0);
    expect(lauf.stderr).toContain(meldung);
  });
});
