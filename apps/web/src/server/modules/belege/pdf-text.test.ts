import { execFileSync } from "node:child_process";
import { detectOwnInvoice } from "@haben/core";
import { renderInvoicePdf } from "@haben/einvoice";
import { describe, expect, it } from "vitest";
import { ownCompanyOf } from "./own-invoice-facts.ts";
import { invoiceDocument, ownSeller } from "./own-invoice-fixtures.ts";
import { parseBboxLayout, pdfTextLines } from "./pdf-text.ts";

const hasPdftotext = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const company = ownCompanyOf({ ...ownSeller, bundesland: "BW" });

describe("Textebene aus pdftotext -bbox-layout", () => {
  it("liest Zeilen mit Lage relativ zur Seite und löst Entitäten auf", () => {
    const xhtml = `<doc><page width="600" height="800"><flow><block>
      <line xMin="60" yMin="720" xMax="300" yMax="730"><word xMin="60" yMin="720">Müller</word><word>&amp;</word><word>Söhne</word></line>
      <line xMin="300" yMin="80" xMax="400" yMax="90"><word>USt-IdNr.</word><word>DE&#x31;23</word></line>
    </block></flow></page><page width="600" height="800"><flow><block><line xMin="0" yMin="0"><word>Seite</word><word>2</word></line></block></flow></page></doc>`;
    expect(parseBboxLayout(xhtml)).toEqual([
      { page: 1, text: "Müller & Söhne", top: 0.9, left: 0.1 },
      { page: 1, text: "USt-IdNr. DE123", top: 0.1, left: 0.5 },
      { page: 2, text: "Seite 2", top: 0, left: 0 },
    ]);
  });

  it("ohne Text oder bei kaputter Datei keine Zeilen", async () => {
    expect(parseBboxLayout("<doc></doc>")).toEqual([]);
    expect(await pdfTextLines(new TextEncoder().encode("%PDF-1.7 kaputt"))).toBeNull();
  });

  // Zweites TDD-Review PR #363: Die Erkennung ist eine Zugabe und darf den Upload nie aufhalten
  it("ohne beschreibbares Temp-Verzeichnis keine Zeilen statt eines Fehlers", async () => {
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = "/gibt-es-nicht/haben-review";
    try {
      expect(await pdfTextLines(new TextEncoder().encode("%PDF-1.7 kaputt"))).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
    }
  });
});

describe.skipIf(!hasPdftotext)("eigene Rechnung an der Textebene erkennen (mit pdftotext)", () => {
  it("die eigene Rechnung im Layout von Haben: sicher", async () => {
    const lines = await pdfTextLines(renderInvoicePdf(invoiceDocument("eigene")));
    expect(lines).not.toBeNull();
    const verdict = detectOwnInvoice({ lines: lines! }, company);
    expect(verdict.level).toBe("sicher");
    expect(verdict.signals.filter((s) => s.direction === "own").map((s) => s.rule)).toEqual(
      expect.arrayContaining(["ust-id-im-text", "steuernummer-im-text", "iban-im-text"]),
    );
  });

  it("die Rechnung eines Lieferanten an uns: keine eigene", async () => {
    const lines = await pdfTextLines(renderInvoicePdf(invoiceDocument("eingang")));
    const verdict = detectOwnInvoice({ lines: lines! }, company);
    expect(verdict.level).toBe("keine");
    expect(verdict.signals).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "name-im-text", direction: "foreign" })]));
  });
});
