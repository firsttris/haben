import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
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

describe("ZIP für das Release", () => {
  const out = mkdtempSync(join(tmpdir(), "haben-erweiterung-"));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  // Der Chrome Web Store verlangt manifest.json im Hauptverzeichnis des ZIPs
  it("enthält die Dateien der Erweiterung ohne Unterordner, mit der Version aus dem Tag", () => {
    const script = fileURLToPath(new URL("./paket.ts", import.meta.url));
    execFileSync(process.execPath, [script, "v0.3.1", out], { stdio: "pipe" });
    const zip = join(out, "haben-fuer-mein-elster-chrome-0.3.1.zip");

    const dateien = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n").sort();
    expect(dateien).toEqual(["content.js", "fill.js", "manifest.json", "popup.html", "popup.js"]);
    const gepackt = JSON.parse(execFileSync("unzip", ["-p", zip, "manifest.json"], { encoding: "utf8" }));
    const quelle = JSON.parse(readFileSync(new URL("../../apps/elster-helfer/manifest.json", import.meta.url), "utf8"));
    expect(gepackt).toEqual({ ...quelle, version: "0.3.1" });
  });
});
