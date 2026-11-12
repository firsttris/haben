import { describe, expect, it } from "vitest";
import { csvKopfzeile, DTD_DATEI, indexXml, mitIndexXml, spaltenTyp } from "./beschreibung.ts";
import type { ArchiveFile } from "./export.ts";

/** Wie csv() in export.ts: UTF-8 mit BOM, Semikolon, CRLF, Anführungszeichen nach RFC 4180 (ohne die Datenbank zu laden) */
const csvZeile = (werte: string[]) => `${werte.map((w) => (/[;"\r\n]/.test(w) ? `"${w.replace(/"/g, '""')}"` : w)).join(";")}\r\n`;
const csv = (kopf: string[], zeilen: string[][]) => new TextEncoder().encode(`﻿${csvZeile(kopf)}${zeilen.map(csvZeile).join("")}`);

/*
 * index.xml für das Jahresarchiv (#546): die Beschreibungsdatei nach dem Beschreibungsstandard der Finanzverwaltung
 * (GDPdU/GoBD, Version 1.6 von 2019), mit der Prüfsoftware die CSV-Dateien einliest (Datenträgerüberlassung, Z3, § 147
 * Abs. 6 AO). Je CSV eine Table mit Spalten, Formaten und Trennern. Die Annahme durch eine Prüfsoftware ist ungeprüft.
 */

interface Knoten {
  name: string;
  text: string;
  kinder: Knoten[];
}

/** Kleiner Parser für die erzeugte Datei (ohne Attribute, Kommentare, Entitäten außer den fünf Standardzeichen) */
function parse(xml: string): Knoten {
  const body = xml.replace(/<\?xml[^>]*\?>/, "").replace(/<!DOCTYPE[^>]*>/, "");
  const wurzel: Knoten = { name: "#root", text: "", kinder: [] };
  const stapel = [wurzel];
  for (const m of body.matchAll(/<(\/?)([A-Za-z0-9]+)(\/?)>|([^<]+)/g)) {
    const aktuell = stapel[stapel.length - 1]!;
    if (m[4] !== undefined) {
      aktuell.text += m[4]
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
        .replace(/&amp;/g, "&");
    } else if (m[1] === "/") {
      stapel.pop();
    } else {
      const k: Knoten = { name: m[2]!, text: "", kinder: [] };
      aktuell.kinder.push(k);
      if (m[3] !== "/") stapel.push(k);
    }
  }
  return wurzel.kinder[0]!;
}

const namen = (k: Knoten) => k.kinder.map((c) => c.name);

/** Die Inhaltsmodelle des Standards, soweit index.xml sie nutzt (DTD Version 1.6): Reihenfolge der Kindelemente */
function pruefeModell(k: Knoten): string[] {
  const fehler: string[] = [];
  const reihenfolge = (erlaubt: string[], pflicht: string[]) => {
    let pos = -1;
    for (const kind of k.kinder) {
      const i = erlaubt.indexOf(kind.name);
      if (i < 0) fehler.push(`${k.name}: ${kind.name} nicht erlaubt`);
      else if (i < pos) fehler.push(`${k.name}: ${kind.name} an falscher Stelle`);
      else pos = i;
    }
    for (const p of pflicht) if (!namen(k).includes(p)) fehler.push(`${k.name}: ${p} fehlt`);
  };
  switch (k.name) {
    case "DataSet":
      reihenfolge(["Version", "DataSupplier", "Media"], ["Version", "Media"]);
      break;
    case "DataSupplier":
      reihenfolge(["Name", "Location", "Comment"], ["Name", "Location", "Comment"]);
      break;
    case "Media":
      reihenfolge(["Name", "Table"], ["Name"]);
      break;
    case "Table":
      reihenfolge(["URL", "Name", "Description", "UTF8", "DecimalSymbol", "DigitGroupingSymbol", "Range", "VariableLength"], ["URL", "VariableLength"]);
      if (namen(k).includes("DecimalSymbol") !== namen(k).includes("DigitGroupingSymbol"))
        fehler.push("Table: DecimalSymbol und DigitGroupingSymbol nur zusammen");
      break;
    case "Range":
      reihenfolge(["From", "To", "Length"], ["From"]);
      break;
    case "VariableLength":
      reihenfolge(["ColumnDelimiter", "RecordDelimiter", "TextEncapsulator", "VariableColumn"], ["VariableColumn"]);
      break;
    case "VariableColumn":
      reihenfolge(["Name", "Description", "Numeric", "AlphaNumeric", "Date"], ["Name"]);
      if (["Numeric", "AlphaNumeric", "Date"].filter((n) => namen(k).includes(n)).length !== 1) fehler.push("VariableColumn: genau ein Datentyp");
      break;
    case "Numeric":
      reihenfolge(["Accuracy"], []);
      break;
    case "Date":
      reihenfolge(["Format"], []);
      break;
  }
  for (const kind of k.kinder) fehler.push(...pruefeModell(kind));
  return fehler;
}

const datei = (path: string, kopf: string[], zeilen: string[][] = []): ArchiveFile => ({ path, content: csv(kopf, zeilen), compress: true });

async function sammle(files: ArchiveFile[]): Promise<ArchiveFile[]> {
  async function* quelle() {
    yield* files;
  }
  const out: ArchiveFile[] = [];
  for await (const f of mitIndexXml(quelle(), { name: "Testfirma", ort: "Regensburg", jahr: 2026, version: "0.8.0" })) {
    // Wie zipArchive: Ein Strom wird ganz gelesen, bevor die nächste Datei kommt
    if (f.content instanceof Uint8Array) out.push(f);
    else {
      const teile: number[] = [];
      for await (const chunk of f.content) teile.push(...chunk);
      out.push({ ...f, content: Uint8Array.from(teile) });
    }
  }
  return out;
}

const decode = (f: ArchiveFile) => new TextDecoder().decode(f.content as Uint8Array);

describe("csvKopfzeile", () => {
  it("liest die Überschriften einer CSV des Archivs, mit BOM und Anführungszeichen", () => {
    expect(csvKopfzeile(csv(["Nummer", "Netto 19 %", 'Name; "Zusatz"'], []))).toEqual(["Nummer", "Netto 19 %", 'Name; "Zusatz"']);
  });
});

describe("spaltenTyp", () => {
  it("kennt Beträge und Daten nur dort, wo das Archiv sie so schreibt; alles andere ist Text", () => {
    expect(spaltenTyp("rechnungen/rechnungen.csv", "Netto")).toEqual({ art: "zahl", nachkommastellen: 2 });
    expect(spaltenTyp("rechnungen/rechnungen.csv", "Datum")).toEqual({ art: "datum" });
    expect(spaltenTyp("buchungen/journal.csv", "Soll")).toEqual({ art: "zahl", nachkommastellen: 2 });
    expect(spaltenTyp("bank/DE12120300001234567890/umsaetze.csv", "Betrag")).toEqual({ art: "zahl", nachkommastellen: 2 });
    // Nummern behalten führende Nullen, Zeitstempel sind keine Daten, unbekannte Dateien bleiben Text
    expect(spaltenTyp("rechnungen/rechnungen.csv", "Nummer")).toEqual({ art: "text" });
    expect(spaltenTyp("rechnungen/rechnungen.csv", "Festgeschrieben")).toEqual({ art: "text" });
    expect(spaltenTyp("kasse/kassenbuch.csv", "Betrag")).toEqual({ art: "text" });
  });
});

describe("indexXml", () => {
  const xml = () =>
    indexXml({
      name: "Müller & Söhne <GmbH>",
      ort: "Regensburg",
      jahr: 2026,
      version: "0.8.0",
      tabellen: [
        { path: "rechnungen/rechnungen.csv", spalten: ["Nummer", "Datum", "Netto"] },
        { path: "bank/DE12120300001234567890/umsaetze.csv", spalten: ["Buchungsdatum", "Betrag", "Verwendungszweck"] },
      ],
    });

  it("beginnt mit der XML-Deklaration und verweist auf die DTD, die dem Archiv nicht beiliegt", () => {
    const text = xml();
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(text).toContain(`<!DOCTYPE DataSet SYSTEM "${DTD_DATEI}">`);
    expect(DTD_DATEI).toBe("gdpdu-01-03-2019.dtd");
  });

  it("hält die Inhaltsmodelle des Standards ein", () => {
    expect(pruefeModell(parse(xml()))).toEqual([]);
  });

  it("beschreibt je CSV eine Table: Pfad, UTF-8, Dezimalkomma, Kopfzeile übersprungen, Trenner, Spalten in Dateireihenfolge", () => {
    const set = parse(xml());
    const tabellen = set.kinder.find((k) => k.name === "Media")!.kinder.filter((k) => k.name === "Table");
    expect(tabellen.map((t) => t.kinder.find((k) => k.name === "URL")!.text)).toEqual([
      "bank/DE12120300001234567890/umsaetze.csv",
      "rechnungen/rechnungen.csv",
    ]);
    const t = tabellen[1]!;
    expect(namen(t)).toEqual(["URL", "Name", "Description", "UTF8", "DecimalSymbol", "DigitGroupingSymbol", "Range", "VariableLength"]);
    expect(t.kinder.find((k) => k.name === "DecimalSymbol")!.text).toBe(",");
    expect(t.kinder.find((k) => k.name === "Range")!.kinder.map((k) => [k.name, k.text])).toEqual([["From", "2"]]);
    const v = t.kinder.find((k) => k.name === "VariableLength")!;
    expect(v.kinder.filter((k) => k.name !== "VariableColumn").map((k) => [k.name, k.text])).toEqual([
      ["ColumnDelimiter", ";"],
      ["RecordDelimiter", "\r\n"],
      ["TextEncapsulator", '"'],
    ]);
    const spalten = v.kinder.filter((k) => k.name === "VariableColumn");
    expect(spalten.map((s) => s.kinder.find((k) => k.name === "Name")!.text)).toEqual(["Nummer", "Datum", "Netto"]);
    expect(spalten.map((s) => namen(s).filter((n) => n !== "Name"))).toEqual([["AlphaNumeric"], ["Date"], ["Numeric"]]);
    expect(spalten[1]!.kinder.find((k) => k.name === "Date")!.kinder.map((k) => k.text)).toEqual(["YYYY-MM-DD"]);
    expect(spalten[2]!.kinder.find((k) => k.name === "Numeric")!.kinder.map((k) => [k.name, k.text])).toEqual([["Accuracy", "2"]]);
  });

  it("schreibt den Datenlieferanten mit Firma, Ort und dem Hinweis, dass die Annahme durch die Prüfsoftware ungeprüft ist", () => {
    const lieferant = parse(xml()).kinder.find((k) => k.name === "DataSupplier")!;
    expect(lieferant.kinder.map((k) => k.text)).toEqual(["Müller & Söhne <GmbH>", "Regensburg", expect.stringContaining("Jahresarchiv 2026")]);
    expect(lieferant.kinder[2]!.text).toContain("Haben 0.8.0");
  });

  it("entschärft Sonderzeichen in Namen", () => {
    expect(xml()).toContain("Müller &amp; Söhne &lt;GmbH&gt;");
  });

  it("ist bei gleicher Eingabe gleich, unabhängig von der Reihenfolge der Tabellen", () => {
    const a = { name: "A", ort: "B", jahr: 2026, version: "1" };
    const t1 = { path: "b.csv", spalten: ["x"] };
    const t2 = { path: "a.csv", spalten: ["y"] };
    expect(indexXml({ ...a, tabellen: [t1, t2] })).toBe(indexXml({ ...a, tabellen: [t2, t1] }));
  });
});

describe("Befunde des Reviews (#546)", () => {
  it("beschreibt keine fremden Originale, die zufällig auf .csv enden (DATEV-Stapel, Lexoffice-Belege, Belege, sevDesk-Auftragsdokumente), nur Haben-eigene CSVs, auch die anhaenge.csv unter anhaenge/", async () => {
    const fremd = new TextEncoder().encode('"EXTF";700;21;"Buchungsstapel";13;20260101\r\nUmsatz;SH;Konto\r\n');
    const out = await sammle([
      { path: "lexoffice/originale/datev/EXTF_x.csv", content: fremd, compress: true },
      { path: "lexoffice/belege/2026-01-01_x_ab12cd34.csv", content: fremd, compress: true },
      { path: "belege/2026-09-29_Lieferant_ab12cd34.csv", content: fremd, compress: true },
      { path: "sevdesk/auftraege/2026-03-01_AB-1_ab12cd34/cd34ef56_Auftrag.csv", content: fremd, compress: false },
      datei("sevdesk/auftraege.csv", ["Datum"]),
      datei("lexoffice/belege.csv", ["Datum", "Art"]),
      datei("belege/belege.csv", ["Datum", "Netto"]),
      datei("belege/verrechnungen.csv", ["Datum"]),
      datei("rechnungen/anhaenge/anhaenge.csv", ["Rechnung"]),
      datei("angebote/anhaenge/anhaenge.csv", ["Angebot"]),
    ]);
    const urls = [...decode(out.at(-1)!).matchAll(/<URL>([^<]+)<\/URL>/g)].map((m) => m[1]);
    expect(urls).toEqual([
      "angebote/anhaenge/anhaenge.csv",
      "belege/belege.csv",
      "belege/verrechnungen.csv",
      "lexoffice/belege.csv",
      "rechnungen/anhaenge/anhaenge.csv",
      "sevdesk/auftraege.csv",
    ]);
  });

  it("lässt in Firmenname, Ort, Pfaden und Spaltennamen alle Zeichen weg, die XML 1.0 nicht kennt (Steuerzeichen, einzelne Surrogate)", () => {
    const xml = indexXml({
      name: "Fir\u0001ma\u000B",
      ort: "O\u001Frt\uD800",
      jahr: 2026,
      version: "1",
      tabellen: [{ path: "a\u0002.csv", spalten: ["Sp\u0003alte\uDC00"] }],
    });
    // nach Codepunkten: ein Paar z\u00E4hlt als eins, ein einzelnes Surrogat bliebe als U+D800 bis U+DFFF stehen
    const ungueltig = Array.from(xml, (c) => c.codePointAt(0)!).filter(
      (c) => (c < 0x20 && c !== 9 && c !== 10 && c !== 13) || (c >= 0xd800 && c <= 0xdfff) || c === 0xfffe || c === 0xffff,
    );
    expect(ungueltig).toEqual([]);
    expect(xml).toContain("<Name>Firma</Name>");
    expect(xml).toContain("<Name>Spalte</Name>");
    // ein gültiges Paar (Emoji) und Tab, Zeilenumbruch bleiben
    expect(indexXml({ name: "A\u{1F600}B", ort: "x", jahr: 2026, version: "1", tabellen: [] })).toContain("A\u{1F600}B");
  });

  it("wartet beim Strom auf den Zeilenumbruch außerhalb von Anführungszeichen: eine Überschrift mit Umbruch in Anführungszeichen, in kleinen Stücken", async () => {
    const bytes = new TextEncoder().encode('\uFEFF"A\nB";C\r\n1;2\r\n');
    async function* stuecke() {
      for (let i = 0; i < bytes.length; i += 4) yield bytes.slice(i, i + 4);
    }
    const out = await sammle([{ path: "protokoll/audit.csv", content: stuecke(), compress: true }]);
    expect([...decode(out[1]!).matchAll(/<VariableColumn>/g)]).toHaveLength(2);
  });
});

describe("mitIndexXml", () => {
  it("reicht alle Dateien unverändert durch und hängt index.xml mit allen CSVs hinten an", async () => {
    const files = [
      datei("rechnungen/rechnungen.csv", ["Nummer", "Datum", "Netto"], [["2026-001", "2026-09-05", "4000,00"]]),
      { path: "belege/foto.jpg", content: new Uint8Array([1, 2, 3]), compress: false },
      datei("stammdaten/bankkonten.csv", ["Name", "IBAN", "ID"]),
    ];
    const out = await sammle(files);
    expect(out.map((f) => f.path)).toEqual([...files.map((f) => f.path), "index.xml"]);
    expect(out.slice(0, 3)).toEqual(files);
    const xml = decode(out[3]!);
    expect(xml).toContain("<URL>rechnungen/rechnungen.csv</URL>");
    expect(xml).toContain("<URL>stammdaten/bankkonten.csv</URL>");
    expect(xml).not.toContain("foto.jpg");
    expect(pruefeModell(parse(xml))).toEqual([]);
  });

  it("liest die Kopfzeile auch aus einer CSV, die als Strom in kleinen Stücken kommt (etwa das Änderungsprotokoll), und gibt sie unverändert weiter", async () => {
    const bytes = csv(["Zeitpunkt", "Benutzer", "Hash"], [["2026-01-01T00:00:00.000Z", "a", "b"]]);
    async function* stuecke() {
      for (let i = 0; i < bytes.length; i += 3) yield bytes.slice(i, i + 3);
    }
    const out = await sammle([{ path: "protokoll/audit.csv", content: stuecke(), compress: true }]);
    expect(out.map((f) => f.path)).toEqual(["protokoll/audit.csv", "index.xml"]);
    expect(out[0]!.content).toEqual(bytes);
    expect(decode(out[1]!)).toContain("<Name>Zeitpunkt</Name>");
    expect(decode(out[1]!)).toContain("<Name>Hash</Name>");
  });

  it("legt für ein Archiv ohne CSV eine index.xml ohne Tabellen an", async () => {
    const out = await sammle([{ path: "LIESMICH.txt", content: new TextEncoder().encode("x"), compress: true }]);
    expect(out.at(-1)!.path).toBe("index.xml");
    expect(pruefeModell(parse(decode(out.at(-1)!)))).toEqual([]);
  });
});
