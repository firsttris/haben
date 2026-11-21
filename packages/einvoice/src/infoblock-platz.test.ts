import { DEFAULT_OPTIONS, EINGEBAUTE_LAYOUTS, type EingebautesLayout, layoutOptionen, wertErlaubt } from "@haben/core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dunningPdfData } from "./dunning.ts";
import { layoutTemplate, pdfData, templateInputs } from "./pdf.ts";
import { createRenderClient } from "./render-client.ts";
import { sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";
import { PACKAGE_DIR } from "./typst-compiler.ts";

/*
 * Codex-Review #454: Ein langer Kerndaten-Block (sieben Zeilen, so viele wie Haben heute setzt) darf in keinem Layout
 * über den Inhalt darunter laufen, weder über die weiteren Referenzen noch über den Betreff. Gemessen an der Lage der
 * Wörter im PDF (pdftotext -bbox).
 */

const templates = join(PACKAGE_DIR, "templates");
const client = createRenderClient({ timeoutMs: 20_000 });
afterAll(() => client.close());

function woerter(pdf: Uint8Array): { wort: string; oben: number; unten: number }[] | null {
  const dir = mkdtempSync(join(tmpdir(), "haben-infoblock-"));
  try {
    writeFileSync(join(dir, "beleg.pdf"), pdf);
    const html = execFileSync("pdftotext", ["-bbox", "-f", "1", "-l", "1", join(dir, "beleg.pdf"), "-"], { encoding: "utf8" });
    return [...html.matchAll(/<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({
      wort: m[3]!,
      oben: Number(m[1]),
      unten: Number(m[2]),
    }));
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let vorhanden = true;
try {
  execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
} catch {
  vorhanden = false;
}

function kombinationen(layout: EingebautesLayout): Record<string, string>[] {
  let ergebnis: Record<string, string>[] = [{}];
  for (const option of layout.optionen) {
    ergebnis = ergebnis.flatMap((bisher) => {
      const erlaubt = option.werte.filter((wert) => wertErlaubt(wert, bisher));
      return erlaubt.length === 0 ? [bisher] : erlaubt.map((wert) => ({ ...bisher, [option.id]: wert.id }));
    });
  }
  return ergebnis;
}

/** Sieben Kerndaten, die letzte mit Marke, dahinter zwei Referenzen, die erste mit Marke */
const mahnung = () =>
  dunningPdfData({
    level: 1,
    date: "2026-10-15",
    dueDate: "2026-10-25",
    seller: sampleSeller,
    buyer: sampleBuyer,
    invoice: { number: "2026-001", issueDate: "2026-09-01", dueDate: "2026-09-15" },
    amounts: { open: 119_000, fee: 0, flatFee: 0, interest: 0, interestRate: 0, interestDays: 0, total: 119_000 },
    intro: "Bitte zahlen.",
    closing: "",
  });

const lang = (art: "beleg" | "mahnung") => {
  const daten = (art === "beleg" ? pdfData(sampleDocument()) : mahnung()) as { meta: { label: string; value: string; group?: string }[] };
  const kern = [
    { label: "Rechnungsnummer", value: "2026-034" },
    { label: "Rechnungsdatum", value: "02.10.2026" },
    { label: "Leistungszeitraum", value: "01.09.2026 – 30.09.2026" },
    { label: "Kundennummer", value: "K-1007" },
    { label: "Lieferantennummer", value: "L-4711" },
    { label: "Ihre Bestellung", value: "PO-2026-551" },
    { label: "USt-IdNr. Kunde", value: "KERNENDE" },
  ].map((zeile) => ({ ...zeile, group: "kerndaten" }));
  const referenzen = [
    { label: "REFANFANG", value: "AB-2026-12", group: "referenz" },
    { label: "Lieferschein", value: "LS-2026-40", group: "referenz" },
  ];
  return { ...daten, meta: [...kern, ...referenzen] };
};

const fassungen = EINGEBAUTE_LAYOUTS.flatMap((layout) => kombinationen(layout).map((k) => ({ id: layout.id, optionen: layoutOptionen(layout, k) })));

describe.skipIf(!vorhanden)("Langer Kerndaten-Block in allen eingebauten Layouts", () => {
  for (const { id, optionen } of fassungen)
    for (const art of ["beleg", "mahnung"] as const) {
      it(`${id} ${JSON.stringify(optionen)} (${art}): Kerndaten enden über den Referenzen`, async () => {
        const letterhead = { options: { ...DEFAULT_OPTIONS }, layout: { id, optionen } };
        const job = { workspace: templates, main: join(templates, layoutTemplate(art, letterhead)), data: templateInputs(lang(art), letterhead), files: [] };
        const liste = woerter(await client.renderPdf(job, "2026-10-02"))!;
        const ende = liste.find((w) => w.wort === "KERNENDE");
        const anfang = liste.find((w) => w.wort.toUpperCase() === "REFANFANG");
        expect(ende && anfang, "Marken auf dem Blatt").toBeTruthy();
        expect(ende!.unten).toBeLessThan(anfang!.oben);
      });
    }
});
