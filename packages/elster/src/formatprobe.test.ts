import { describe, expect, it } from "vitest";
import { FakeElsterClient } from "./fake-client.ts";
import { checkFormats, ericMeldungen, formatProben } from "./formatprobe.ts";
import { datenartVersionFromXml, hasTestmerker } from "./xml.ts";

const input = { idnr: "65929970489", geburtsdatum: "1985-04-12", datenlieferant: "Test", herstellerId: "74931", veranlagungsjahr: 2025, produktVersion: "0.1.0" };

describe("Formatprüfung", () => {
  it("baut je Nachricht eine Probe wie beim echten Senden", () => {
    const proben = formatProben(input);
    expect(proben.map((p) => datenartVersionFromXml(p.xml))).toEqual([
      "ElsterVaStDaten_31",
      "ElsterVaStDaten_31",
      "SpezRechtAntrag",
      "SpezRechtFreischaltung",
      "SpezRechtStorno",
      "SpezRechtListe",
      "PostfachAnfrage_31",
      "PostfachBestaetigung_31",
    ]);
    expect(proben.every((p) => !hasTestmerker(p.xml))).toBe(true);
  });

  it("liest die Meldungen von ERiC", () => {
    const xml = `<EricBearbeiteVorgang><FehlerRegelpruefung><Text>Element &lt;Foo&gt; unbekannt</Text></FehlerRegelpruefung>
      <FehlerRegelpruefung><Text>Element &lt;Foo&gt;   unbekannt</Text></FehlerRegelpruefung><Hinweis><Text>B &amp; C</Text></Hinweis></EricBearbeiteVorgang>`;
    expect(ericMeldungen(xml)).toEqual(["Element <Foo> unbekannt", "B & C"]);
  });

  it("validiert jede Probe einzeln", async () => {
    const results = await checkFormats(new FakeElsterClient(), input);
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.ok && r.meldungen.length === 0)).toBe(true);
  });
});
