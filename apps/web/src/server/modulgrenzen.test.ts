import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import haben from "../../../../eslint/modulgrenzen.js";

/*
 * Modulgrenzen (#81, Schritt 6): die Lint-Regel selbst und die Struktur der Module.
 * Ob der echte Code die Grenzen einhält, prüft `pnpm lint` in der CI; hier geht es darum, dass die Regel greift.
 */

const server = fileURLToPath(new URL(".", import.meta.url));
const modules = join(server, "modules");

/** Meldungen der Regel für eine Datei mit diesem Inhalt an diesem Ort (Pfad relativ zu server/) */
function lint(path: string, code: string): string[] {
  const linter = new Linter();
  const messages = linter.verify(
    code,
    [{ files: ["**/*.ts"], languageOptions: { parser: tseslint.parser }, plugins: { haben }, rules: { "haben/modulgrenzen": "error" } }],
    join(server, path),
  );
  return messages.map((m) => m.message);
}

describe("Lint-Regel haben/modulgrenzen", () => {
  it("aus einem anderen Modul nur über index.ts", () => {
    expect(lint("modules/umsatzsteuer/vat.ts", `import { loadCompany } from "../stammdaten/index.ts";`)).toEqual([]);
    expect(lint("modules/umsatzsteuer/vat.ts", `import { loadCompany } from "../stammdaten/company.ts";`)).toEqual([
      expect.stringContaining("Modul „stammdaten“ nur über seine index.ts importieren, nicht „company.ts“"),
    ]);
    // Auch Typen, Re-Exporte und dynamische Importe
    expect(lint("modules/umsatzsteuer/vat.ts", `import type { Company } from "../stammdaten/company.ts";`)).toHaveLength(1);
    expect(lint("modules/umsatzsteuer/vat.ts", `export { loadCompany } from "../stammdaten/company.ts";`)).toHaveLength(1);
    expect(lint("modules/umsatzsteuer/vat.ts", `export * from "../stammdaten/company.ts";`)).toHaveLength(1);
    expect(lint("modules/umsatzsteuer/vat.ts", `const m = await import("../stammdaten/company.ts");`)).toHaveLength(1);
    expect(lint("modules/umsatzsteuer/vat.ts", `type C = import("../stammdaten/company.ts").Company;`)).toHaveLength(1);
    expect(lint("../components/InvoiceEditor.tsx", `type I = import("../server/modules/rechnungen/invoices.ts").Invoice;`)).toHaveLength(1);
    expect(lint("modules/umsatzsteuer/vat.ts", `type C = import("../stammdaten/index.ts").Company;`)).toEqual([]);
  });

  it("der Modulordner selbst und index ohne Endung zählen als index.ts", () => {
    expect(lint("modules/umsatzsteuer/vat.ts", `import { loadCompany } from "../stammdaten";`)).toEqual([]);
    expect(lint("modules/umsatzsteuer/vat.ts", `import { loadCompany } from "../stammdaten/";`)).toEqual([]);
    expect(lint("modules/umsatzsteuer/vat.ts", `import { loadCompany } from "../stammdaten/index";`)).toEqual([]);
    // Für die Infrastruktur bleibt das ein Modulimport
    expect(lint("today.ts", `import { loadCompany } from "./modules/stammdaten";`)).toHaveLength(1);
    expect(lint("db/actor.ts", `import { post } from "../modules/buchhaltung";`)).toHaveLength(1);
    expect(lint("today.ts", `type C = import("./modules/stammdaten").Company;`)).toHaveLength(1);
  });

  it("innerhalb eines Moduls frei, auch von außen über index.ts", () => {
    expect(lint("modules/umsatzsteuer/vat.ts", `import { computeVatFigures } from "./vat-figures.ts";`)).toEqual([]);
    expect(lint("functions/vat.ts", `import { saveDraft } from "../modules/umsatzsteuer/index.ts";`)).toEqual([]);
    expect(lint("../routes/api/konten/$jahr.ts", `import { saldenliste } from "../../../server/modules/buchhaltung/index.ts";`)).toEqual([]);
  });

  it("Server Functions und Oberfläche greifen nicht hinter index.ts", () => {
    expect(lint("functions/vat.ts", `import { saveDraft } from "../modules/umsatzsteuer/vat.ts";`)).toHaveLength(1);
    expect(lint("../components/InvoiceEditor.tsx", `import type { Invoice } from "../server/modules/rechnungen/invoices.ts";`)).toHaveLength(1);
  });

  it("Infrastruktur importiert kein Modul, die zusammensetzenden Stellen schon", () => {
    expect(lint("today.ts", `import { loadCompany } from "./modules/stammdaten/index.ts";`)).toEqual([
      expect.stringContaining("Gemeinsame Infrastruktur darf kein Modul importieren („stammdaten“)"),
    ]);
    expect(lint("db/actor.ts", `import { post } from "../modules/buchhaltung/index.ts";`)).toHaveLength(1);
    expect(lint("scheduler.ts", `import { runReminders } from "./modules/mail/index.ts";`)).toEqual([]);
    expect(lint("plugins/scheduler.ts", `import { startScheduler } from "../scheduler.ts";`)).toEqual([]);
    // Infrastruktur untereinander bleibt frei
    expect(lint("middleware.ts", `import { auth } from "./auth.ts";`)).toEqual([]);
  });

  it("Module importieren keine Server Functions und keine Oberfläche, src/lib/ schon", () => {
    expect(lint("modules/rechnungen/invoices.ts", `import { finalizeInvoiceFn } from "../../functions/invoices.ts";`)).toEqual([
      expect.stringContaining("Ein Modul importiert keine Server Functions und keine Oberfläche"),
    ]);
    expect(lint("modules/rechnungen/invoices.ts", `import { Badge } from "../../../components/Badge.tsx";`)).toHaveLength(1);
    expect(lint("modules/auswertungen/integrity.ts", `import { formatPruefwert } from "../../../lib/pruefwert.ts";`)).toEqual([]);
    // Pakete und Infrastruktur bleiben frei
    expect(lint("modules/rechnungen/invoices.ts", `import { lineAmount } from "@haben/core";\nimport { db } from "../../db/index.ts";`)).toEqual([]);
  });
});

describe("Struktur der Module", () => {
  const names = readdirSync(modules, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

  it("jedes Modul hat eine index.ts", () => {
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((name) => !existsSync(join(modules, name, "index.ts")))).toEqual([]);
  });

  it("index.ts gibt nur Dateien des eigenen Moduls weiter und enthält keine Logik", () => {
    for (const name of names) {
      const lines = readFileSync(join(modules, name, "index.ts"), "utf8")
        .split("\n")
        .filter((line) => line.trim() && !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"));
      const text = lines.join("\n");
      for (const [, from] of text.matchAll(/from "([^"]+)"/g)) expect(from, `${name}: ${from}`).toMatch(/^\.\/[^/]+\.ts$/);
      // Nur export { … } from "./…", auch über mehrere Zeilen
      expect(text.replace(/export \{[^}]*\} from "\.\/[^"]+";/g, "").trim(), name).toBe("");
    }
  });

  it("keine Dienste mehr direkt unter server/, nur Infrastruktur", () => {
    const top = readdirSync(server).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(top.sort()).toEqual(
      ["auth.ts", "crypto.ts", "env.ts", "errors.ts", "file-response.ts", "middleware.ts", "scheduler.ts", "security-headers.ts", "storage.ts", "test-db.ts", "test-eric.ts", "today.ts"].sort(),
    );
  });
});
