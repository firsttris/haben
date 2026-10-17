import { basename, dirname, resolve, sep } from "node:path";

/*
 * Modulgrenzen im Server (#81, Schritt 6). Fachlicher Code liegt in apps/web/src/server/modules/<name>/; was ein Modul
 * nach außen anbietet, steht in seiner index.ts. Die Regel prüft jeden relativen Import:
 *
 * - Aus einem anderen Modul nur über dessen index.ts, nie direkt in eine Datei dahinter.
 * - Gemeinsame Infrastruktur (server/*.ts, server/db/) importiert gar kein Modul, sonst hängt sie an der Fachlogik.
 *   Ausgenommen sind die Stellen, die Module zusammensetzen: functions/, plugins/ und scheduler.ts.
 * - Module importieren weder Server Functions noch Oberfläche (routes/, components/); src/lib/ ist erlaubt. Die
 *   Abhängigkeit läuft nur von außen nach innen.
 *
 * Tests sind ausgenommen (siehe eslint.config.js), sie dürfen in Dateien anderer Module greifen.
 */

const MODULES = `${sep}src${sep}server${sep}modules${sep}`;
const SERVER = `${sep}src${sep}server${sep}`;
const COMPOSITION = [`${SERVER}functions${sep}`, `${SERVER}plugins${sep}`];
const OUTSIDE = [`${SERVER}functions${sep}`, `${SERVER}plugins${sep}`, `${sep}src${sep}routes${sep}`, `${sep}src${sep}components${sep}`];

/**
 * Modulname und Pfad unterhalb des Moduls, oder null außerhalb von modules/. Der Modulordner selbst und `index` ohne
 * Endung lösen wie `index.ts` auf.
 */
function moduleOf(file) {
  const at = file.lastIndexOf(MODULES);
  if (at < 0) return null;
  const [name, ...rest] = file.slice(at + MODULES.length).split(sep).filter(Boolean);
  if (!name) return null;
  const inner = rest.join("/");
  return { name, inner: inner === "" || inner === "index" ? "index.ts" : inner };
}

function isInfrastructure(file) {
  const at = file.lastIndexOf(SERVER);
  if (at < 0 || moduleOf(file)) return false;
  if (COMPOSITION.some((dir) => file.includes(dir))) return false;
  return basename(file) !== "scheduler.ts";
}

/** @type {import("eslint").Rule.RuleModule} */
const modulgrenzen = {
  meta: {
    type: "problem",
    docs: { description: "Module nur über ihre index.ts importieren; Infrastruktur importiert keine Module" },
    schema: [],
    messages: {
      index: "Modul „{{module}}“ nur über seine index.ts importieren, nicht „{{inner}}“. Fehlt der Name dort, ergänze ihn in modules/{{module}}/index.ts.",
      aussen: "Ein Modul importiert keine Server Functions und keine Oberfläche („{{path}}“). Gemeinsames gehört in das Modul oder in src/lib/.",
      infrastruktur: "Gemeinsame Infrastruktur darf kein Modul importieren („{{module}}“). Gehört der Code ins Modul, verschiebe ihn dorthin.",
    },
  },
  create(context) {
    const file = resolve(context.filename);
    const own = moduleOf(file);
    const infrastructure = isInfrastructure(file);

    function check(node) {
      const source = node?.source;
      if (!source || source.type !== "Literal" || typeof source.value !== "string" || !source.value.startsWith(".")) return;
      const path = resolve(dirname(file), source.value);
      if (own && OUTSIDE.some((dir) => path.includes(dir))) {
        context.report({ node: source, messageId: "aussen", data: { path: source.value } });
        return;
      }
      const target = moduleOf(path);
      if (!target || target.name === own?.name) return;
      if (infrastructure) {
        context.report({ node: source, messageId: "infrastruktur", data: { module: target.name } });
      } else if (target.inner !== "index.ts") {
        context.report({ node: source, messageId: "index", data: { module: target.name, inner: target.inner } });
      }
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
      // type T = import("…").T
      TSImportType: check,
    };
  },
};

export default { meta: { name: "haben" }, rules: { modulgrenzen } };
