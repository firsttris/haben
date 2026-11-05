import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { antwort, nachgestellt } from "./nachgestellt.ts";
import { mitAktuellenHashes, type Norm, normText, pruefeNormen } from "./normen.ts";

// Aufbau einer Einzelnorm auf gesetze-im-internet.de (gekürzt): Navigation, Überschrift, Text, Fußnote, Fußzeile
const seite = (
  absatz: string,
  navigation = "__246.html",
) => `<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" /></head><body>
<div id="blaettern_zurueck"><a href='${navigation}'>zur&uuml;ck</a></div>
<div class="jnheader"> <a name="BJNR001950896BJNE024002377"/><a href="index.html#BJNR001950896BJNE024002377">Nichtamtliches Inhaltsverzeichnis</a><h1>B&#252;rgerliches Gesetzbuch (BGB)<br /><span class="jnenbez">&#167; 247</span>&#160;<span class="jnentitel">Basiszinssatz</span></h1> </div>
<div class="jnhtml"><div><div class="jurAbsatz">${absatz}</div></div></div>
<div class="jnfussnote"><div class="jnhtml">Fu&#223;note</div></div>
    </div>
    <div id="fusszeile"><ul class="footerul"><li>Impressum</li></ul></div></body></html>`;

const URL_247 = "https://www.gesetze-im-internet.de/bgb/__247.html";
const norm = (sha256: string): Norm => ({
  id: "bgb-247",
  norm: "§ 247 BGB",
  url: URL_247,
  zweck: "Basiszinssatz",
  stellen: ["packages/core/src/dunning.ts"],
  sha256,
});
const latin1 = (s: string) => antwort(200, s, { "content-type": "text/html" });
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

describe("Normtext", () => {
  it("nimmt Überschrift, Text und Fußnoten, ohne Navigation, Anker und Fußzeile", () => {
    expect(normText(seite("(1) Der Basiszinssatz betr&#228;gt 3,62&#160;Prozent."))).toBe(
      "Bürgerliches Gesetzbuch (BGB) § 247 Basiszinssatz (1) Der Basiszinssatz beträgt 3,62 Prozent. Fußnote",
    );
  });

  it("ändert sich nicht mit der Navigation, wohl aber mit dem Text", () => {
    const a = normText(seite("(1) Text"));
    expect(normText(seite("(1) Text", "__246a.html"))).toBe(a);
    expect(normText(seite("(1)   Text\n"))).toBe(a);
    expect(normText(seite("(1) Neuer Text"))).not.toBe(a);
  });

  it("erkennt eine Seite ohne Einzelnorm", () => {
    expect(normText("<html><body>Wartung</body></html>")).toBeNull();
  });
});

describe("Gesetzeswächter", () => {
  const unveraendert = hash(normText(seite("(1) Text"))!);

  it("meldet nichts bei unverändertem Text", async () => {
    const { ergebnis } = await pruefeNormen([norm(unveraendert)], nachgestellt({ [URL_247]: latin1(seite("(1) Text")) }));
    expect(ergebnis).toEqual({ befunde: [], warnungen: [] });
  });

  it("meldet eine geänderte Norm mit Link, Zweck und Stellen in Haben", async () => {
    const { ergebnis, stand } = await pruefeNormen([norm(unveraendert)], nachgestellt({ [URL_247]: latin1(seite("(1) Neu")) }));
    expect(ergebnis.warnungen).toEqual([]);
    expect(ergebnis.befunde).toHaveLength(1);
    const [b] = ergebnis.befunde;
    expect(b?.schluessel).toBe("norm-bgb-247");
    expect(b?.titel).toBe("§ 247 BGB geändert – prüfen, ob Haben betroffen ist");
    expect(b?.text).toContain(URL_247);
    expect(b?.text).toContain("- `packages/core/src/dunning.ts`");
    expect(b?.text).toContain("--normen-schreiben");
    expect(stand[0]?.sha256).toBe(hash(normText(seite("(1) Neu"))!));
  });

  it("warnt bei einer Norm ohne Hash und bei einer Quelle, die nicht antwortet", async () => {
    const { ergebnis, stand } = await pruefeNormen([norm("")], nachgestellt({ [URL_247]: latin1(seite("(1) Text")) }));
    expect(ergebnis.befunde).toEqual([]);
    expect(ergebnis.warnungen[0]).toContain("noch kein Hash");
    expect(mitAktuellenHashes(stand)[0]?.sha256).toBe(unveraendert);

    const weg = await pruefeNormen([norm(unveraendert)], nachgestellt({ [URL_247]: antwort(503) }));
    expect(weg.ergebnis).toEqual({ befunde: [], warnungen: [`§ 247 BGB: ${URL_247} nicht erreichbar (HTTP 503)`] });
    // Nicht abrufbar: der bisherige Hash bleibt
    expect(mitAktuellenHashes(weg.stand)[0]?.sha256).toBe(unveraendert);
  });

  it("normen.json: jede Norm mit Hash, eindeutiger Kennung und vorhandenen Stellen", () => {
    const { normen } = JSON.parse(readFileSync(new URL("./normen.json", import.meta.url), "utf8")) as { normen: Norm[] };
    expect(new Set(normen.map((n) => n.id)).size).toBe(normen.length);
    for (const n of normen) {
      expect(n.sha256, n.norm).toMatch(/^[0-9a-f]{64}$/);
      expect(n.url, n.norm).toMatch(/^https:\/\/www\.gesetze-im-internet\.de\/[\w-]+\/__\w+\.html$/);
      for (const s of n.stellen) expect(() => readFileSync(new URL(`../../${s}`, import.meta.url)), s).not.toThrow();
    }
  });
});
