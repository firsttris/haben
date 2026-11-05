import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { darf, steuerberatungSieht } from "../lib/rollen.ts";

/*
 * Rechte der Rolle Steuerberatung (Roadmap Platz 10, Stufe 1). Diese Tests lesen alle Server Functions und API-Routen aus
 * dem Quelltext: Eine neue Funktion ist ohne Zutun nur für den Inhaber (`authMiddleware`); was die Steuerberatung lesen darf,
 * steht hier in einer Liste, die bei jeder Erweiterung bewusst angepasst wird.
 */

const server = fileURLToPath(new URL(".", import.meta.url));
const routesApi = fileURLToPath(new URL("../routes/api", import.meta.url));

/** Lesende Server Functions, die auch die Steuerberatung aufrufen darf. Nur GET, nur Lesen, keine Geheimnisse. */
const STEUERBERATUNG_LIEST = [
  "documents.ts:getDocumentDetail",
  "documents.ts:getDocuments",
  "export.ts:getExportYears",
  "invoices.ts:getInvoiceDetail",
  "invoices.ts:getInvoices",
  "journal.ts:getJournal",
  "ledger.ts:getKontenblatt",
  "ledger.ts:getSaldenliste",
  "reports.ts:getReports",
  "zugang.ts:getSteuerberatungStart",
];

/** Ohne Anmeldung: Zustand für Anmelde- und Einrichtungsseite, Prüfung eines Einladungslinks. Beide lesen nur. */
const OEFFENTLICH = ["setup.ts:getAuthState", "zugang.ts:checkInvitation"];

/** API-Routen mit Sitzung, die auch die Steuerberatung abrufen darf (nur GET, Dateien und Exporte) */
const STEUERBERATUNG_LAEDT = [
  "auswertungen/$jahr.ts",
  "beleg/$id.ts",
  "datev/$jahr.ts",
  "export/$jahr.ts",
  "konten/$jahr.ts",
  "mahnung/$id.ts",
  "rechnung/$id.$datei.ts",
  "rechnungsanhang/$id.ts",
];

/** API-Routen ohne Sitzung: eigene Anmeldung (Better Auth), API-Token (MCP, REST) oder geheimer Link (Kalender) */
const OHNE_SITZUNG = ["auth/$.ts", "fristen/kalender.ts", "mcp.ts", "v1/$.ts"];

interface ServerFn {
  id: string;
  method: string;
  middleware: string[];
}

function serverFunctions(): ServerFn[] {
  const dir = join(server, "functions");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .flatMap((file) => {
      const code = readFileSync(join(dir, file), "utf8");
      const found = [...code.matchAll(/export const (\w+) = createServerFn\(\{ method: "(\w+)" \}\)([\s\S]*?)\.handler\(/g)].map(([, name, method, chain]) => ({
        id: `${file}:${name}`,
        method: method!,
        middleware: [...(chain!.match(/\.middleware\(\[([^\]]*)\]\)/)?.[1] ?? "").matchAll(/\w+/g)].map(([m]) => m),
      }));
      // Jede Server Function muss erkannt werden, sonst prüfte der Test sie nicht
      expect(found.length, file).toBe(code.match(/createServerFn\(/g)?.length ?? 0);
      return found;
    });
}

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));

function apiRoutes(): { id: string; code: string }[] {
  return walk(routesApi).map((path) => ({ id: relative(routesApi, path), code: readFileSync(path, "utf8") }));
}

describe("Rechte der Rollen", () => {
  it("der Inhaber darf alles, die Steuerberatung nur lesen, eine unbekannte Rolle nichts", () => {
    expect(darf("inhaber", "inhaber")).toBe(true);
    expect(darf("inhaber", "lesen")).toBe(true);
    expect(darf("steuerberatung", "lesen")).toBe(true);
    expect(darf("steuerberatung", "inhaber")).toBe(false);
    expect(darf("admin", "lesen")).toBe(false);
    expect(darf("", "lesen")).toBe(false);
  });

  it("die Steuerberatung sieht nur ihre Seiten, keine zum Anlegen oder Einstellen", () => {
    for (const path of [
      "/steuerberatung",
      "/auswertungen",
      "/buchungen",
      "/konten",
      "/konten/1400",
      "/belege",
      "/rechnungen/",
      "/belege/0b8f6a52-6d3e-4d43-9a43-3b0c5d1e2f10",
    ]) {
      expect(steuerberatungSieht(path), path).toBe(true);
    }
    for (const path of [
      "/",
      "/einstellungen",
      "/buchungen/neu",
      "/rechnungen/neu",
      "/rechnungen/wiederkehrend",
      "/bank",
      "/umsatzsteuer",
      "/lohn",
      "/konten/abc",
    ]) {
      expect(steuerberatungSieht(path), path).toBe(false);
    }
  });
});

describe("Server Functions", () => {
  const fns = serverFunctions();

  it("findet alle Server Functions", () => {
    expect(fns.length).toBeGreaterThan(200);
  });

  it("jede Server Function mit Daten prüft Sitzung und Rolle über genau eine Middleware", () => {
    const ohne = fns.filter((fn) => fn.middleware.length === 0).map((fn) => fn.id);
    expect(ohne.sort()).toEqual([...OEFFENTLICH].sort());
    for (const fn of fns.filter((f) => f.middleware.length > 0)) {
      expect(fn.middleware, fn.id).toHaveLength(1);
      expect(["authMiddleware", "readMiddleware"], fn.id).toContain(fn.middleware[0]);
    }
  });

  it("jede schreibende Server Function (POST) ist nur für den Inhaber", () => {
    const post = fns.filter((fn) => fn.method !== "GET");
    expect(post.length).toBeGreaterThan(100);
    for (const fn of post) expect(fn.middleware, fn.id).toEqual(["authMiddleware"]);
  });

  it("die Steuerberatung erreicht nur die geprüften lesenden Funktionen", () => {
    const lesend = fns.filter((fn) => fn.middleware.includes("readMiddleware"));
    expect(lesend.map((fn) => fn.id).sort()).toEqual([...STEUERBERATUNG_LIEST].sort());
    for (const fn of lesend) expect(fn.method, fn.id).toBe("GET");
    for (const id of OEFFENTLICH) expect(fns.find((fn) => fn.id === id)?.method, id).toBe("GET");
  });
});

describe("API-Routen", () => {
  const routes = apiRoutes();

  it("keine Route liest die Sitzung an der Rollenprüfung vorbei", () => {
    for (const route of routes) expect(route.code, route.id).not.toMatch(/getSession|auth\(\)\.api/);
  });

  it("jede Route mit Sitzung sagt, welchen Zugriff sie braucht; die Steuerberatung lädt nur die geprüften", () => {
    const mitSitzung = routes.filter((route) => !OHNE_SITZUNG.includes(route.id));
    const lesen: string[] = [];
    for (const route of mitSitzung) {
      const zugriffe = [...route.code.matchAll(/requireUser\(request, "(\w+)"\)|darf\(user\.role, "(\w+)"\)/g)].map(([, a, b]) => a ?? b);
      expect(zugriffe.length, route.id).toBeGreaterThan(0);
      if (zugriffe.every((z) => z === "lesen")) lesen.push(route.id);
      else expect(zugriffe, route.id).toEqual(zugriffe.map(() => "inhaber"));
    }
    expect(lesen.sort()).toEqual([...STEUERBERATUNG_LAEDT].sort());
  });

  it("Routen, die die Steuerberatung lädt, antworten nur auf GET", () => {
    for (const id of STEUERBERATUNG_LAEDT) {
      const code = routes.find((route) => route.id === id)?.code ?? "";
      expect(
        [...code.matchAll(/^\s+(\w+): async/gm)].map(([, m]) => m),
        id,
      ).toEqual(["GET"]);
    }
  });
});

describe("Wo Server-Code steht", () => {
  const src = fileURLToPath(new URL("..", import.meta.url));
  const files = walk(src)
    .filter((path) => !/\.test\.tsx?$/.test(path) && !path.endsWith("routeTree.gen.ts"))
    .map((path) => ({ id: relative(src, path), code: readFileSync(path, "utf8") }));

  // Nur dort lesen die Tests oben jede Server Function und jede Route; anderswo fiele eine ohne Rollenprüfung nicht auf
  it("Server Functions stehen nur direkt in server/functions", () => {
    const elsewhere = files.filter((f) => f.code.includes("createServerFn") && !/^server\/functions\/[^/]+\.ts$/.test(f.id)).map((f) => f.id);
    expect(elsewhere).toEqual([]);
  });

  it("HTTP-Handler stehen nur in routes/api", () => {
    const elsewhere = files.filter((f) => /\bhandlers\s*:/.test(f.code) && !f.id.startsWith("routes/api/")).map((f) => f.id);
    expect(elsewhere).toEqual([]);
  });

  it("jeder Handler einer Route mit Sitzung prüft den Zugriff selbst", () => {
    for (const route of apiRoutes().filter((r) => !OHNE_SITZUNG.includes(r.id))) {
      const handlers = route.code.match(/^\s+(GET|POST|PUT|PATCH|DELETE): /gm)?.length ?? 0;
      const checks = route.code.match(/requireUser\(request, "\w+"\)|darf\(user\.role, "\w+"\)/g)?.length ?? 0;
      expect(checks, route.id).toBe(handlers);
    }
  });
});
