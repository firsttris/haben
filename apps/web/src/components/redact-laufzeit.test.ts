import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as redactCreateElement } from "@tanstack/redact";
import { renderToStaticMarkup as redactRenderToStaticMarkup } from "@tanstack/redact/server";
import { describe, expect, it } from "vitest";

function redactVersion(paket: string, feld: "dependencies" | "devDependencies"): string | undefined {
  const manifest = JSON.parse(readFileSync(new URL(paket, import.meta.url), "utf8")) as Record<typeof feld, Record<string, string>>;
  return manifest[feld]["@tanstack/redact"];
}

describe("Laufzeit der Komponententests", () => {
  it("rendert mit TanStack Redact wie Browser und SSR, nicht mit React", () => {
    expect(createElement).toBe(redactCreateElement);
    expect(renderToStaticMarkup).toBe(redactRenderToStaticMarkup);
  });

  it("nutzt in der Wurzel dieselbe Redact-Version wie die App", () => {
    const app = redactVersion("../../package.json", "dependencies");
    expect(app).toMatch(/^\d+\.\d+\.\d+$/);
    expect(redactVersion("../../../../package.json", "devDependencies")).toBe(app);
  });
});
