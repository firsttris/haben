import { describe, expect, it } from "vitest";
import { HABEN_KONTENRAHMEN_STAND, KONTENRAHMEN, pruefeKontenrahmen, standAusSeite } from "./datev.ts";
import { antwort, nachgestellt, netzwerkfehler } from "./nachgestellt.ts";

// Ausschnitt der Merkmalliste auf der Produktseite des DATEV-Shops (05.11.2026)
const seite = (stand: string) => `<div class="attributes-list__table__row">
  <span class="attributes-list__table__row--label">Stand</span>
                         <span class="attributes-list__table__row--description">
                             ${stand}
                         </span>
</div>`;
const [SKR03, SKR04] = KONTENRAHMEN.map((k) => k.url) as [string, string];
const html = (s: string) => antwort(200, s, { "content-type": "text/html;charset=UTF-8" });

describe("DATEV-Kontenrahmen", () => {
  it("liest den Stand aus der Produktseite", () => {
    expect(standAusSeite(seite("Januar 2026"))).toBe("Januar 2026");
    expect(standAusSeite("<html></html>")).toBeNull();
  });

  it("meldet nichts bei der Ausgabe, nach der Haben zuordnet", async () => {
    const holen = nachgestellt({ [SKR03]: html(seite(HABEN_KONTENRAHMEN_STAND)), [SKR04]: html(seite(HABEN_KONTENRAHMEN_STAND)) });
    expect(await pruefeKontenrahmen(holen)).toEqual({ befunde: [], warnungen: [] });
    expect(holen.aufrufe[0]?.init?.redirect).toBe("follow");
  });

  it("meldet je Kontenrahmen eine neue Ausgabe", async () => {
    const e = await pruefeKontenrahmen(nachgestellt({ [SKR03]: html(seite("Januar 2027")), [SKR04]: html(seite("Januar 2026")) }), "Januar 2026");
    expect(e.warnungen).toEqual([]);
    expect(e.befunde.map((b) => [b.schluessel, b.titel])).toEqual([["datev-skr03", "DATEV-Kontenrahmen SKR03: neue Ausgabe (Januar 2027)"]]);
    expect(e.befunde[0]?.text).toContain("Art.-Nr. 11174");
    expect(e.befunde[0]?.text).toContain("HABEN_KONTENRAHMEN_STAND");
  });

  it("verweist im Issue auf die Schritte im Skill", async () => {
    const e = await pruefeKontenrahmen(nachgestellt({ [SKR03]: html(seite("Januar 2027")), [SKR04]: html(seite("Januar 2027")) }), "Januar 2026");
    expect(e.befunde).toHaveLength(2);
    for (const b of e.befunde) expect(b.text).toContain("skills/jahreswerte/SKILL.md#kontenrahmen");
  });

  it("macht aus einer Seite ohne Stand oder ohne Antwort eine Warnung", async () => {
    const e = await pruefeKontenrahmen(nachgestellt({ [SKR03]: html("<html>umgebaut</html>"), [SKR04]: netzwerkfehler }));
    expect(e.befunde).toEqual([]);
    expect(e.warnungen).toEqual([`SKR03: „Stand“ auf ${SKR03} nicht gefunden`, `SKR04: ${SKR04} nicht erreichbar (Connection reset by peer)`]);
  });
});
