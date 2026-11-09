import { describe, expect, it } from "vitest";
import { missingPages, OPEN, pagesOf, pathsIn, staleExceptions } from "./regel.ts";

/** So steht ein Pfad mit Ausdruck im Quelltext einer Spec, als Text gelesen */
// biome-ignore lint/suspicious/noTemplateCurlyInString: der Ausdruck ist hier Text aus der Spec, kein Platzhalter
const ZM = "/umsatzsteuer/zm/${YEAR + 1}-Q1";

const routeTree = `
export interface FileRoutesByFullPath {
  '/': typeof AppIndexRoute
  '/login': typeof LoginRoute
  '/bank': typeof AppBankRoute
  '/api/beleg/$id': typeof ApiBelegIdRoute
  '/einladung/$token': typeof EinladungTokenRoute
  '/rechnungen/$id': typeof AppRechnungenIdRoute
  '/rechnungen/': typeof AppRechnungenIndexRoute
  '/umsatzsteuer/zm/$quartal': typeof AppUmsatzsteuerZmQuartalRoute
}
export interface FileRoutesByTo {
  '/kasse': typeof AppKasseRoute
}`;

describe("pagesOf", () => {
  it("nimmt Seiten aus FileRoutesByFullPath, ohne API, Anmeldung und Einladung, Index ohne Schrägstrich", () => {
    expect(pagesOf(routeTree)).toEqual(["/", "/bank", "/rechnungen/$id", "/rechnungen", "/umsatzsteuer/zm/$quartal"]);
  });
});

describe("pathsIn", () => {
  it("liest Strings, Template-Strings mit Ausdrücken und firstLink-Muster, ohne Query", () => {
    const spec = `
      ["bank", "/bank?x=1"],
      \`/umsatzsteuer/zm/\${YEAR + 1}-Q1\`,
      firstLink(page, "/rechnungen", /^\\/rechnungen\\/[0-9a-f-]{36}$/),
      "kein Pfad",
    `;
    expect(pathsIn(spec)).toEqual(["/bank", ZM, "/rechnungen", "/rechnungen/[0-9a-f-]{36}"]);
  });
});

describe("missingPages", () => {
  const pages = ["/", "/bank", "/rechnungen/$id", "/umsatzsteuer/zm/$quartal", "/kasse"];
  const paths = ["/", "/bank", "/rechnungen/[0-9a-f-]{36}", ZM];

  it("meldet eine Seite, die die Spec nicht aufruft", () => {
    expect(missingPages(pages, paths, {})).toEqual(["/kasse"]);
  });

  it("lässt eine ausdrücklich ausgenommene Seite aus", () => {
    expect(missingPages(pages, paths, { "/kasse": "Grund" })).toEqual([]);
  });

  it("verwechselt einen Parameter nicht mit mehreren Segmenten", () => {
    expect(missingPages(["/rechnungen/$id"], ["/rechnungen/a/b"], {})).toEqual(["/rechnungen/$id"]);
  });

  it("zählt den Aufruf einer festen Nachbarseite wie /rechnungen/neu nicht als Aufruf von /rechnungen/$id", () => {
    // Der Router wählt für /rechnungen/neu die feste Route, nicht den Parameter (TanStack Router: statische Segmente vor Parametern)
    expect(missingPages(["/rechnungen/neu", "/rechnungen/$id"], ["/rechnungen/neu"], {})).toEqual(["/rechnungen/$id"]);
  });
});

describe("staleExceptions", () => {
  it("meldet Ausnahmen für entfernte und inzwischen geprüfte Seiten", () => {
    const exceptions = { "/weg": "Grund", "/bank": OPEN, "/kasse": OPEN };
    expect(staleExceptions(["/bank", "/kasse"], ["/bank"], exceptions)).toEqual(["/weg", "/bank"]);
  });

  it("behält eine Ausnahme mit eigenem Grund, auch wenn der Pfad in der Spec steht (etwa als 404-Test)", () => {
    const exceptions = { "/rechnungen/mahnwesen/$id": "nur ein 404-Test ruft sie auf" };
    expect(staleExceptions(["/rechnungen/mahnwesen/$id"], ["/rechnungen/mahnwesen/[^/]+"], exceptions)).toEqual([]);
  });
});
