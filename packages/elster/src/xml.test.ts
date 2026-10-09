import { describe, expect, it } from "vitest";
import {
  buildUstvaXml,
  datenartVersionFromXml,
  elsterDecimal,
  escapeXml,
  hasTestmerker,
  TEST_HERSTELLER_ID,
  ustvaDatenartVersion,
  type UstvaXmlInput,
} from "./xml.ts";

const base: UstvaXmlInput = {
  period: { year: 2026, month: 3 },
  steuernummer13: "9198011310010",
  figures: { kz81: 100_000, kz86: 50_000, kz66: 1_745, kz83: 17_355 },
  datenlieferant: { name: "Erika Mustermann", strasse: "Hauptstr. 1", plz: "10115", ort: "Berlin" },
  herstellerId: TEST_HERSTELLER_ID,
  produktVersion: "0.1.0",
  test: true,
  erstellungsdatum: new Date(2026, 3, 5),
};

function tag(xml: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];
}

describe("buildUstvaXml", () => {
  it("schreibt Kopf und Nutzdaten", () => {
    const xml = buildUstvaXml(base);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(tag(xml, "Verfahren")).toBe("ElsterAnmeldung");
    expect(tag(xml, "DatenArt")).toBe("UStVA");
    expect(tag(xml, "Vorgang")).toBe("send-Auth");
    expect(tag(xml, "HerstellerID")).toBe("74931");
    expect(tag(xml, "Verschluesselung")).toBe("CMSEncryptedData");
    expect(tag(xml, "Kompression")).toBe("GZIP");
    expect(xml).toContain("<TransportSchluessel></TransportSchluessel>");
    expect(xml).toContain('<NutzdatenHeader version="11">');
    expect(tag(xml, "ProduktName")).toBe("Haben");
    expect(tag(xml, "ProduktVersion")).toBe("0.1.0");
    expect(xml).toContain('art="UStVA" version="2026"');
    expect(tag(xml, "Erstellungsdatum")).toBe("20260405");
    expect(tag(xml, "Jahr")).toBe("2026");
    expect(tag(xml, "Steuernummer")).toBe("9198011310010");
    expect(tag(xml, "Name")).toBe("Erika Mustermann");
    expect(tag(xml, "PLZ")).toBe("10115");
  });

  it("setzt das Finanzamt als Empfänger", () => {
    expect(buildUstvaXml(base)).toContain('<Empfaenger id="F">9198</Empfaenger>');
    expect(buildUstvaXml({ ...base, steuernummer13: "5133081508159" })).toContain('<Empfaenger id="F">5133</Empfaenger>');
  });

  it("füllt den Zeitraum zweistellig auf", () => {
    expect(tag(buildUstvaXml(base), "Zeitraum")).toBe("03");
    expect(tag(buildUstvaXml({ ...base, period: { year: 2026, month: 12 } }), "Zeitraum")).toBe("12");
  });

  it("schreibt Kennzahlen im ELSTER-Format", () => {
    const xml = buildUstvaXml(base);
    expect(tag(xml, "Kz81")).toBe("1000");
    expect(tag(xml, "Kz86")).toBe("500");
    expect(tag(xml, "Kz66")).toBe("17,45");
    expect(tag(xml, "Kz83")).toBe("173,55");
  });

  it("schreibt Umsätze ohne Steuer (Kz 21, 45, 48) und sortiert aufsteigend", () => {
    const xml = buildUstvaXml({ ...base, figures: { kz81: 100_000, kz86: 0, kz21: 500_099, kz45: 0, kz48: -20_000, kz66: 0, kz83: 19_000 } });
    expect(tag(xml, "Kz21")).toBe("5000");
    expect(tag(xml, "Kz48")).toBe("-200");
    expect(xml).not.toContain("<Kz45>");
    const order = [...xml.matchAll(/<Kz(\d+)>/g)].map((m) => Number(m[1]));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("schreibt § 13b als Leistungsempfänger: Kz 46/84 in Euro, Steuer 47/85 und Vorsteuer 67 in Cent", () => {
    const xml = buildUstvaXml({
      ...base,
      figures: { kz81: 0, kz86: 0, kz66: 0, kz46: 12_345, kz47: 2_345, kz84: 5_000, kz85: 950, kz67: 3_295, kz83: 0 },
    });
    expect(tag(xml, "Kz46")).toBe("123");
    expect(tag(xml, "Kz47")).toBe("23,45");
    expect(tag(xml, "Kz84")).toBe("50");
    expect(tag(xml, "Kz85")).toBe("9,50");
    expect(tag(xml, "Kz67")).toBe("32,95");
    const order = [...xml.matchAll(/<Kz(\d+)>/g)].map((m) => Number(m[1]));
    expect(order).toEqual([46, 47, 67, 83, 84, 85]);
  });

  it("lässt Nullwerte weg, Kz83 aber nie", () => {
    const xml = buildUstvaXml({ ...base, figures: { kz81: 0, kz86: 0, kz66: 0, kz83: 0 } });
    expect(xml).not.toContain("<Kz81>");
    expect(xml).not.toContain("<Kz86>");
    expect(xml).not.toContain("<Kz66>");
    expect(tag(xml, "Kz83")).toBe("0,00");
  });

  it("schreibt Erstattungen negativ", () => {
    const xml = buildUstvaXml({ ...base, figures: { kz81: 0, kz86: 0, kz66: 1_200, kz83: -1_200 } });
    expect(tag(xml, "Kz83")).toBe("-12,00");
  });

  it("setzt den Testmerker nur im Testfall", () => {
    expect(tag(buildUstvaXml(base), "Testmerker")).toBe("700000004");
    expect(hasTestmerker(buildUstvaXml(base))).toBe(true);
    const echt = buildUstvaXml({ ...base, test: false });
    expect(echt).not.toContain("Testmerker");
    expect(hasTestmerker(echt)).toBe(false);
  });

  it("erkennt jeden Testmerker, nicht nur die von Haben gesetzten", () => {
    expect(hasTestmerker("<Testmerker>700000001</Testmerker>")).toBe(true);
    expect(hasTestmerker("<Testmerker> 370000001 </Testmerker>")).toBe(true);
    expect(hasTestmerker("<Testmerker></Testmerker>")).toBe(false);
    expect(hasTestmerker("<Testmerker> </Testmerker>")).toBe(false);
  });

  it("maskiert Sonderzeichen und entfernt in XML 1.0 unzulässige Steuerzeichen", () => {
    expect(escapeXml(`a&b<c>"d"'e'`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;");
    expect(escapeXml("A\u0000B\u0007C\u001FD\uFFFEE\uD800F")).toBe("ABCDEF");
    // Tab, Zeilenumbrüche, Umlaute und Emoji (Surrogatpaar) bleiben
    expect(escapeXml("x\ty\r\nzäö😀")).toBe("x\ty\r\nzäö😀");
  });

  it("markiert berichtigte Anmeldungen mit Kz10", () => {
    expect(buildUstvaXml(base)).not.toContain("<Kz10>");
    expect(tag(buildUstvaXml({ ...base, berichtigt: true }), "Kz10")).toBe("1");
  });

  it("maskiert XML-Sonderzeichen", () => {
    const xml = buildUstvaXml({
      ...base,
      datenlieferant: { name: `Müller & Söhne <"GmbH">`, strasse: "Weg 'A'", plz: "1", ort: "Ort" },
    });
    expect(tag(xml, "Name")).toBe("Müller &amp; Söhne &lt;&quot;GmbH&quot;&gt;");
    expect(tag(xml, "Strasse")).toBe("Weg &apos;A&apos;");
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it("lehnt Steuernummern im falschen Format ab", () => {
    expect(() => buildUstvaXml({ ...base, steuernummer13: "21/815/08150" })).toThrow();
  });

  it("liefert die Datenart-Version", () => {
    expect(ustvaDatenartVersion(2026)).toBe("UStVA_2026");
    expect(datenartVersionFromXml(buildUstvaXml(base))).toBe("UStVA_2026");
    expect(datenartVersionFromXml("<Elster/>")).toBeUndefined();
  });
});

describe("elsterDecimal", () => {
  it("formatiert ohne Tausenderpunkte", () => {
    expect(elsterDecimal(123_456_789)).toBe("1234567,89");
    expect(elsterDecimal(5)).toBe("0,05");
    expect(elsterDecimal(-5)).toBe("-0,05");
  });
});
