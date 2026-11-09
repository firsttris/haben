import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXCEPTIONS } from "./ausnahmen.ts";
import { missingPages, pagesOf, pathsIn, staleExceptions } from "./regel.ts";

/*
 * Prüft, ob jede Seite in e2e/seiten.spec.ts und e2e/barrierefreiheit.spec.ts vorkommt (regel.ts). Läuft mit
 * `bun run lint`, damit eine neue Seite nicht erst in der E2E-Stufe der CI auffällt, sondern gar nicht vergessen wird.
 */

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

const pages = pagesOf(read("apps/web/src/routeTree.gen.ts"));

const reports = (["seiten", "barrierefreiheit"] as const).flatMap((spec) => {
  const file = `apps/web/e2e/${spec}.spec.ts`;
  const paths = pathsIn(read(file));
  const exceptions = EXCEPTIONS[spec];
  return [
    ...missingPages(pages, paths, exceptions).map((page) => `${file}: Seite ${page} fehlt`),
    ...staleExceptions(pages, paths, exceptions).map((page) => `scripts/seitenabdeckung/ausnahmen.ts: Ausnahme ${page} für ${spec} ist veraltet und kann weg`),
  ];
});

for (const report of reports) console.error(report);
if (reports.length > 0) {
  console.error(`\nSeitenabdeckung: ${reports.length} Meldung${reports.length === 1 ? "" : "en"}`);
  process.exit(1);
}
