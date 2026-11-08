import { describe, expect, it } from "vitest";
import {
  buildUstvaUpload,
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
    expect(xml).toContain('version="2026"');
    expect(xml).not.toContain('art="UStVA"');
    // Schema 2026: Erstellungsdatum vor DatenLieferant, Kz09 mit der Hersteller-ID direkt nach der Steuernummer
    expect(xml).toMatch(/<Erstellungsdatum>\d+<\/Erstellungsdatum>\s*<DatenLieferant>/);
    expect(xml).toMatch(/<Steuernummer>\d+<\/Steuernummer>\s*<Kz09>74931<\/Kz09>/);
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

  it("schreibt Quartale mit dem Schlüssel 41–44", () => {
    expect(tag(buildUstvaXml({ ...base, period: { year: 2026, month: 41 } }), "Zeitraum")).toBe("41");
    expect(tag(buildUstvaXml({ ...base, period: { year: 2026, month: 44 } }), "Zeitraum")).toBe("44");
  });

  it("lehnt Zeiträume ab, die es nicht gibt", () => {
    for (const month of [0, 13, 40, 45]) {
      expect(() => buildUstvaXml({ ...base, period: { year: 2026, month } })).toThrow(`Ungültiger Zeitraum: ${month}`);
    }
  });

  it("schreibt Kennzahlen im ELSTER-Format", () => {
    const xml = buildUstvaXml(base);
    expect(tag(xml, "Kz81")).toBe("1000");
    expect(tag(xml, "Kz86")).toBe("500");
    expect(tag(xml, "Kz66")).toBe("17.45");
    expect(tag(xml, "Kz83")).toBe("173.55");
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
    expect(tag(xml, "Kz47")).toBe("23.45");
    expect(tag(xml, "Kz84")).toBe("50");
    expect(tag(xml, "Kz85")).toBe("9.50");
    expect(tag(xml, "Kz67")).toBe("32.95");
    const order = [...xml.matchAll(/<Kz(\d+)>/g)].map((m) => Number(m[1]));
    expect(order).toEqual([9, 46, 47, 67, 83, 84, 85]);
  });

  it("schreibt innergemeinschaftliche Lieferungen (41), Ausfuhr (43), Erwerbe (89/93 in Euro) und Erwerbsvorsteuer (61 in Cent)", () => {
    const xml = buildUstvaXml({
      ...base,
      figures: { kz81: 0, kz86: 0, kz66: 0, kz41: 300_099, kz43: 120_000, kz89: 50_000, kz93: 10_000, kz61: 10_200, kz83: 0 },
    });
    expect(tag(xml, "Kz41")).toBe("3000");
    expect(tag(xml, "Kz43")).toBe("1200");
    expect(tag(xml, "Kz89")).toBe("500");
    expect(tag(xml, "Kz93")).toBe("100");
    expect(tag(xml, "Kz61")).toBe("102.00");
    const order = [...xml.matchAll(/<Kz(\d+)>/g)].map((m) => Number(m[1]));
    expect(order).toEqual([9, 41, 43, 61, 83, 89, 93]);
  });

  it("schreibt die Einfuhrumsatzsteuer (62 in Cent) nach Kz 61 und vor Kz 66", () => {
    const xml = buildUstvaXml({ ...base, figures: { kz81: 0, kz86: 0, kz66: 1_900, kz61: 500, kz62: 38_000, kz83: -40_400 } });
    expect(tag(xml, "Kz62")).toBe("380.00");
    const order = [...xml.matchAll(/<Kz(\d+)>/g)].map((m) => Number(m[1]));
    expect(order).toEqual([9, 61, 62, 66, 83]);
  });

  it("lässt Nullwerte weg, Kz83 aber nie", () => {
    const xml = buildUstvaXml({ ...base, figures: { kz81: 0, kz86: 0, kz66: 0, kz83: 0 } });
    expect(xml).not.toContain("<Kz81>");
    expect(xml).not.toContain("<Kz86>");
    expect(xml).not.toContain("<Kz66>");
    expect(tag(xml, "Kz83")).toBe("0.00");
  });

  it("schreibt Erstattungen negativ", () => {
    const xml = buildUstvaXml({ ...base, figures: { kz81: 0, kz86: 0, kz66: 1_200, kz83: -1_200 } });
    expect(tag(xml, "Kz83")).toBe("-12.00");
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
    // Erklärungen der GmbH: Gewerbesteuer und Körperschaftsteuer (Unterfallart 30)
    expect(datenartVersionFromXml('<E20 xmlns="x" version="2025">')).toBe("GewSt_2025");
    expect(datenartVersionFromXml('<E30 xmlns="x" version="2025">')).toBe("KSt_30_2025");
    // E-Bilanz: Taxonomie nach dem Datum im Namensraum
    const bilanz = (datum: string) => `<DatenArt>Bilanz</DatenArt><xbrli:xbrl xmlns:de-gcd="http://www.xbrl.de/taxonomies/de-gcd-${datum}">`;
    expect(datenartVersionFromXml(bilanz("2025-04-01"))).toBe("Bilanz_6.9");
    expect(datenartVersionFromXml(bilanz("2024-04-01"))).toBe("Bilanz_6.8");
    expect(datenartVersionFromXml(bilanz("2019-04-01"))).toBeUndefined();
  });
});

describe("elsterDecimal", () => {
  it("formatiert ohne Tausenderpunkte", () => {
    expect(elsterDecimal(123_456_789)).toBe("1234567,89");
    expect(elsterDecimal(5)).toBe("0,05");
    expect(elsterDecimal(-5)).toBe("-0,05");
  });
});

describe("buildUstvaUpload (XML-Import in Mein ELSTER)", () => {
  const latin9 = (bytes: Uint8Array) => new TextDecoder("iso-8859-15").decode(bytes);
  const upload = (input: Partial<UstvaXmlInput> = {}) => {
    const { herstellerId: _h, produktVersion: _p, test: _t, ...rest } = { ...base, ...input };
    return buildUstvaUpload(rest);
  };

  it("enthält nur die Nutzdaten, dieselben wie beim Versand über ERiC", () => {
    const xml = latin9(upload());
    expect(xml.startsWith('<?xml version="1.0" encoding="ISO-8859-15" standalone="no"?>\n<Anmeldungssteuern ')).toBe(true);
    expect(xml).toContain('xmlns="http://finkonsens.de/elster/elsteranmeldung/ustva/v2026" version="2026"');
    expect(xml).not.toMatch(/<Elster|TransferHeader|Testmerker|Nutzdatenblock/);
    const sent = buildUstvaXml(base);
    const nutzdaten = sent.slice(sent.indexOf("<Anmeldungssteuern"), sent.indexOf("</Anmeldungssteuern>") + "</Anmeldungssteuern>".length);
    expect(xml.slice(xml.indexOf("<Anmeldungssteuern"))).toBe(nutzdaten);
  });

  it("Kz09 trägt die Test-Hersteller-ID, die Mein ELSTER beim Import ohnehin nicht übernimmt", () => {
    expect(tag(latin9(upload()), "Kz09")).toBe(TEST_HERSTELLER_ID);
  });

  it("schreibt Umlaute und das Euro-Zeichen in ISO-8859-15, Zeichen außerhalb als Zeichenreferenz", () => {
    const bytes = upload({ datenlieferant: { name: "Müller € GmbH „Nord“", strasse: "Straße 1", plz: "10115", ort: "Köln" } });
    expect([...bytes].some((b) => b > 0x7f && b !== 0xfc && b !== 0xa4 && b !== 0xdf && b !== 0xf6)).toBe(false);
    expect(bytes).toContain(0xa4);
    const xml = latin9(bytes);
    expect(tag(xml, "Name")).toBe("Müller € GmbH &#8222;Nord&#8220;");
    expect(tag(xml, "Strasse")).toBe("Straße 1");
    expect(tag(xml, "Ort")).toBe("Köln");
  });

  it("lehnt einen ungültigen Zeitraum ab wie der Versand", () => {
    expect(() => upload({ period: { year: 2026, month: 13 } })).toThrow("Ungültiger Zeitraum: 13");
  });
});

describe("Erstellungsdatum", () => {
  it("ist der Tag in Deutschland, unabhängig von der Zeitzone des Prozesses", () => {
    // 31.03.2026 22:30 UTC ist in Deutschland schon der 1. April (MESZ)
    expect(tag(buildUstvaXml({ ...base, erstellungsdatum: new Date("2026-03-31T22:30:00Z") }), "Erstellungsdatum")).toBe("20260401");
  });
});
