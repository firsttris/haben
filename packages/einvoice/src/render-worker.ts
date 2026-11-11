/**
 * Render-Prozess: kompiliert Vorlagen zu SVG, nimmt Aufträge per IPC an und bleibt für schnelles Tippen warm. Läuft
 * getrennt von der App, damit eine lange Vorlage sie nicht blockiert; beendet wird er von render-client.ts.
 */
import { join } from "node:path";
import type { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import type { RenderRequest, RenderResponse, RenderedSheet } from "./render-protocol.ts";
import { createCompiler } from "./typst-compiler.ts";

let current: { workspace: string; typst: NodeCompiler } | undefined;

function compilerFor(workspace: string): NodeCompiler {
  if (current?.workspace !== workspace) current = { workspace, typst: createCompiler(workspace) };
  return current.typst;
}

/** Typst nennt nur die Gesamthöhe; alle Seiten eines Belegs sind gleich groß */
function pageSize(svg: string, pages: number): { width: number; height: number } {
  const [, width, height] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg) ?? [];
  return { width: Number(width), height: Number(height) / pages };
}

/** Kompiliert und gibt das SVG oder, mit pdf, das PDF/A-3b als Base64 zurück */
function render({ workspace, main, data, files, pdf }: RenderRequest): RenderedSheet | string {
  const started = performance.now();
  const typst = compilerFor(workspace);
  const shadows = files.map(({ name, base64 }) => [join(workspace, name), Buffer.from(base64, "base64")] as const);
  for (const [path, bytes] of shadows) typst.mapShadow(path, bytes);
  try {
    const result = typst.compile({ mainFilePath: main, inputs: { data: JSON.stringify(data) } });
    const document = result.result;
    if (result.hasError() || !document) {
      const error = result.takeError();
      throw new Error(JSON.stringify(error ? typst.fetchDiagnostics(error) : []));
    }
    if (pdf) {
      const bytes = typst.pdf(document, { pdfStandard: "a-3b", creationTimestamp: Math.floor(Date.parse(`${pdf.date}T12:00:00Z`) / 1000) });
      typst.evictCache(10);
      return Buffer.from(bytes).toString("base64");
    }
    const svg = typst.svg(document);
    const pages = document.numOfPages;
    typst.evictCache(10);
    return { svg, pages, ...pageSize(svg, pages), ms: Math.round(performance.now() - started) };
  } finally {
    for (const [path] of shadows) typst.unmapShadow(path);
  }
}

process.on("message", (request: RenderRequest) => {
  let response: RenderResponse;
  try {
    const result = render(request);
    response = typeof result === "string" ? { id: request.id, ok: true, pdf: result } : { id: request.id, ok: true, sheet: result };
  } catch (error) {
    response = { id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  process.send!(response);
});

// Ohne Elternprozess gibt es niemanden mehr, der Aufträge schickt
process.on("disconnect", () => process.exit(0));
