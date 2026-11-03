import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paketName, releaseManifest } from "./paket.ts";

const manifest = { manifest_version: 3, name: "Haben für Mein ELSTER", version: "0.1.0" };

describe("releaseManifest", () => {
  it("übernimmt die Version aus dem Tag", () => {
    expect(releaseManifest(manifest, "v0.3.1")).toEqual({ ...manifest, version: "0.3.1" });
  });

  it("schreibt bei einem Release Candidate die Ziffern in version und die volle Bezeichnung in version_name", () => {
    // Chrome nimmt in version nur bis zu vier Zahlen mit Punkt, Zusätze wie -rc.2 nur in version_name
    expect(releaseManifest(manifest, "v0.4.0-rc.2")).toEqual({ ...manifest, version: "0.4.0", version_name: "0.4.0-rc.2" });
  });

  it("lehnt einen Tag ohne Version ab", () => {
    expect(() => releaseManifest(manifest, "main")).toThrow("Tag main ist keine Version vX.Y.Z");
  });
});

describe("paketName", () => {
  // Wie bei den anderen Erweiterungen (firsttris/workflows, browser-extension-stores.yml): <name>-chrome-<version>.zip
  it("nennt das ZIP wie der Store-Workflow es erwartet, mit der Version ohne v", () => {
    expect(paketName("v0.4.0-rc.2")).toBe("haben-fuer-mein-elster-chrome-0.4.0-rc.2.zip");
  });
});

/** Breite und Höhe aus dem IHDR-Block einer PNG-Datei */
function pngGroesse(datei: Buffer): [number, number] {
  return [datei.readUInt32BE(16), datei.readUInt32BE(20)];
}

describe("Icons der Erweiterung", () => {
  const quelle = new URL("../../apps/elster-helfer/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", quelle), "utf8"));

  // Ohne Icons zeigt Chrome nur einen Buchstaben; der Chrome Web Store verlangt 128 × 128 (developer.chrome.com, „icons“)
  it("bringt Icons in 16, 32, 48 und 128 Pixeln mit, als PNG in genau dieser Größe", () => {
    expect(Object.keys(manifest.icons ?? {})).toEqual(["16", "32", "48", "128"]);
    for (const [groesse, pfad] of Object.entries(manifest.icons as Record<string, string>)) {
      expect(pngGroesse(readFileSync(new URL(pfad, quelle))), pfad).toEqual([Number(groesse), Number(groesse)]);
    }
  });

  it("zeigt in der Symbolleiste dieselben Icons", () => {
    expect(manifest.action.default_icon).toEqual({ 16: manifest.icons["16"], 32: manifest.icons["32"] });
  });
});

describe("ZIP für das Release", () => {
  const out = mkdtempSync(join(tmpdir(), "haben-erweiterung-"));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  // Gebaut einmal für alle Tests dieses Blocks; das Skript baut die Erweiterung mit Vite und packt dist/
  const script = fileURLToPath(new URL("./paket.ts", import.meta.url));
  const zip = join(out, "haben-fuer-mein-elster-chrome-0.3.1.zip");
  const dateien = () => execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n").sort();
  const gepackt = () => JSON.parse(execFileSync("unzip", ["-p", zip, "manifest.json"], { encoding: "utf8" }));
  beforeAll(() => {
    execFileSync(process.execPath, [script, "v0.3.1", out], { stdio: "pipe" });
  }, 120_000);

  // Der Chrome Web Store verlangt manifest.json im Hauptverzeichnis des ZIPs
  it("enthält die gebaute Erweiterung mit manifest.json im Hauptverzeichnis und der Version aus dem Tag", () => {
    expect(dateien()).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "popup.html",
        "src/content.js",
        "icons/icon-16.png",
        "icons/icon-32.png",
        "icons/icon-48.png",
        "icons/icon-128.png",
      ]),
    );
    expect(gepackt().version).toBe("0.3.1");
  });

  it("enthält nur Gebautes, keine TypeScript-Quellen", () => {
    expect(dateien().filter((d) => d.endsWith(".ts"))).toEqual([]);
    expect(gepackt().content_scripts).toEqual([
      { js: ["src/content.js"], matches: ["https://www.elster.de/eportal/interpreter/eingabe/*"], run_at: "document_idle" },
    ]);
  });

  // Was eine Erweiterung als web_accessible_resources freigibt, kann die Seite abrufen und daran die Erweiterung erkennen
  it("gibt Mein ELSTER keine Dateien der Erweiterung frei", () => {
    expect(gepackt().web_accessible_resources).toBeUndefined();
  });

  it("bringt die Icons aus dem Manifest der Quellen mit", () => {
    const quelle = JSON.parse(readFileSync(new URL("../../apps/elster-helfer/manifest.json", import.meta.url), "utf8"));
    expect(gepackt().icons).toEqual(quelle.icons);
    expect(gepackt().action.default_icon).toEqual(quelle.action.default_icon);
  });
});

describe("ZIP neu packen", () => {
  const out = mkdtempSync(join(tmpdir(), "haben-erweiterung-"));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  // zip -r ergänzt ein vorhandenes Archiv nur; Dateien eines früheren Laufs blieben sonst im Paket
  it("ersetzt ein ZIP gleichen Namens im Ausgabeordner, statt es zu ergänzen", () => {
    const zip = join(out, "haben-fuer-mein-elster-chrome-0.3.1.zip");
    const alt = join(out, "veraltet.js");
    writeFileSync(alt, "// aus einem früheren Stand\n");
    execFileSync("zip", ["-q", "-j", zip, alt]);

    const script = fileURLToPath(new URL("./paket.ts", import.meta.url));
    execFileSync(process.execPath, [script, "v0.3.1", out], { stdio: "pipe" });

    const dateien = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");
    expect(dateien).not.toContain("veraltet.js");
  }, 120_000);
});
