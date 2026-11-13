import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readSevdeskExport } from "./leser.ts";
import { fixture, innerZip, unmaskedStack10, zip } from "./testzip.ts";
import type { SevExport, SevExportResult } from "./types.ts";

const STAPEL = "EXTF_Buchungsstapel_20240101_20241231.csv";
const AUSGANG = "DATEV_Rechnungsausgang_20240101_20241231.zip";
const EINGANG = "DATEV_Rechnungseingang_20240101_20241231.zip";
const guid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const ok = (result: SevExportResult): SevExport => {
  if (!result.ok) throw new Error(result.reason);
  return result.export;
};
const read = (entries: Parameters<typeof zip>[0], limits?: Parameters<typeof readSevdeskExport>[1]["limits"]) =>
  readSevdeskExport(zip(entries), { kontenrahmen: "SKR03", limits });

/** Zeilen des Auszugs aus 2.0 (UTF-8, LF): Kopf, Spalten, Rechnung, Ausgabebeleg, Zahlung, Gutschrift */
const auszug = new TextDecoder().decode(fixture("buchhaltung-2.0/extf-buchungsstapel-auszug.csv")).split("\n");
const [kopf, spalten, rechnung, ausgabe, zahlung] = auszug as [string, string, string, string, string];
const stapel = (...zeilen: string[]) => strToU8([kopf, spalten, ...zeilen].join("\n"));
const ohneBeleglink = (zeile: string) => zeile.replace(/"BEDI ""[^"]+"""/, "");
const ausgangDoc = () => innerZip(fixture("buchhaltung-2.0/document-rechnungsausgang.xml"));
const eingangDoc = (omit: string[] = []) => innerZip(fixture("buchhaltung-2.0/document-rechnungseingang.xml"), omit);

describe("Sonderfälle im Export von sevDesk", () => {
  it("fasst mehrere Zeilen einer GUID zu einem Beleg zusammen; Netto und Steuer je Zeile summiert", () => {
    const zweite = rechnung
      .replace(/^100,00;/, "50,00;")
      .replace(";84,03;", ";42,02;")
      .replace(";15,97;", ";7,98;");
    const data = ok(read({ [STAPEL]: stapel(rechnung, zweite), [AUSGANG]: ausgangDoc() }));
    expect(data.vouchers).toHaveLength(1);
    expect(data.vouchers[0]).toMatchObject({ guid: guid(1), amount: 15000, net: 12605, tax: 2395, rate: 1900 });
    expect(data.vouchers[0]!.lines.map((l) => l.booking.row)).toEqual([3, 4]);
  });

  it("Beleg ohne BEDI: Schlüssel aus Belegnummer und Datum, wiederkehrende Nummer bleibt getrennt", () => {
    const beleg = ohneBeleglink(ausgabe);
    const folgemonat = beleg.replace(";1501;", ";1502;");
    const data = ok(read({ [STAPEL]: stapel(beleg, beleg, folgemonat), [EINGANG]: eingangDoc() }));
    expect(data.vouchers.map((v) => [v.key, v.amount, v.direction, v.directionFrom])).toEqual([
      ["1111111111111111112|2024-01-15|70002|aufwand", 20000, "eingang", "konten"],
      ["1111111111111111112|2024-02-15|70002|aufwand", 10000, "eingang", "konten"],
    ]);
    expect(data.vouchers.every((v) => v.guid === null && v.document === null)).toBe(true);
  });

  it("Beleg ohne BEDI: gleiche Nummer und gleiches Datum bei zwei Lieferanten bleiben zwei Belege", () => {
    const beleg = ohneBeleglink(ausgabe);
    const andererLieferant = beleg.replace(";70002;4985;9;", ";70004;4985;9;");
    expect(andererLieferant).not.toBe(beleg);
    const data = ok(read({ [STAPEL]: stapel(beleg, andererLieferant), [EINGANG]: eingangDoc() }));
    expect(data.vouchers).toHaveLength(2);
    expect(data.vouchers.map((v) => [v.amount, v.lines.map((l) => l.booking.account)])).toEqual([
      [10000, ["70002"]],
      [10000, ["70004"]],
    ]);
  });

  it("Zahlung mit auf 36 Zeichen gekürztem Belegfeld wird kein Beleg, auch nicht mit Satz in Beleginfo", () => {
    const mitSatz = zahlung.replace('"Umsatzsteuerprozent";;', '"Umsatzsteuerprozent";19;');
    expect(mitSatz).not.toBe(zahlung);
    const data = ok(read({ [STAPEL]: stapel(zahlung, mitSatz), [AUSGANG]: ausgangDoc() }));
    const belegfeld = data.stacks[0]!.stack.bookings[0]!.voucherField1;
    expect(belegfeld).toHaveLength(36);
    expect(data.stacks[0]!.stack.bookings[1]!.raw["Beleginfo-Inhalt 2"]).toBe("19");
    expect(data.vouchers).toEqual([]);
  });

  it("meldet eine GUID, die document.xml nicht kennt, und nimmt die Richtung aus dem Kontenbereich", () => {
    // Beispielzeilen aus dem Bericht zu 2.0: Ausgabebeleg auf 4390 mit BEDI, Zahlung mit UUID im Belegfeld
    const data = ok(read({ [STAPEL]: fixture("buchhaltung-2.0/extf-buchungsstapel.csv"), [AUSGANG]: ausgangDoc() }));
    expect(data.vouchers).toHaveLength(1);
    expect(data.vouchers[0]).toMatchObject({ guid: guid(2), direction: "eingang", directionFrom: "konten", document: null, amount: 100 });
    expect(data.hints).toContain(`Beleg -BG-EUR-xx-xxxxx-xxxxxxx-xxxxx-xxxxx (GUID ${guid(2)}): keine Datei im Export.`);
  });

  it("meldet eine Datei, die document.xml nennt, die aber in der inneren ZIP fehlt", () => {
    const name = "2024-01-15_Ausgabebeleg_1111111111111111112_00000000000000000000000000000000.pdf";
    const data = ok(read({ [STAPEL]: stapel(ausgabe), [EINGANG]: eingangDoc([name]) }));
    expect(data.vouchers[0]).toMatchObject({ guid: guid(2), direction: "eingang", directionFrom: "document" });
    expect(data.files.has(guid(2))).toBe(false);
    expect(data.hints).toContain(`${EINGANG}: Datei ${name} (GUID ${guid(2)}) steht in document.xml, fehlt aber in der ZIP.`);
  });

  it("meldet Fremdwährung und lässt den Betrag unverändert", () => {
    const data = ok(read({ [STAPEL]: unmaskedStack10(), [EINGANG]: innerZip(fixture("buchhaltung-1.0/document-rechnungseingang.xml")) }));
    expect(data.vouchers.find((v) => v.guid === guid(2))).toMatchObject({ currency: "USD", amount: 10000 });
    expect(data.hints.filter((h) => h.includes("nicht in Euro umgerechnet"))).toEqual([`${STAPEL}, Zeile 4: Umsatz in USD, nicht in Euro umgerechnet.`]);
  });

  // Echte Exporte (#472, Kommentar in #810): Bei Fremdwährung steht im Umsatz der Betrag in Fremdwährung
  // (sumGrossForeignCurrency), Netto und Steuer der Beleginfo in Euro (sumGross); Kurs und Basis-Umsatz bleiben leer
  it("nimmt bei Fremdwährung den Euro-Betrag aus Beleginfo und behält den Betrag in Fremdwährung", () => {
    const usd = ausgabe.replace(/^100,00;"H";"EUR";/, '106,00;"H";"USD";');
    expect(usd).not.toBe(ausgabe);
    const data = ok(read({ [STAPEL]: stapel(usd), [EINGANG]: eingangDoc() }));
    expect(data.vouchers[0]).toMatchObject({ currency: "USD", amount: 10000, foreignAmount: 10600, net: 8403, tax: 1597 });
    expect(data.vouchers[0]!.lines[0]).toMatchObject({ amount: 10000, foreignAmount: 10600 });
    expect(data.hints.filter((h) => h.includes("Umsatz"))).toEqual([]);
  });

  it("nimmt bei Fremdwährung ohne Steuer das Netto aus Beleginfo als Euro-Betrag", () => {
    const usd = ausgabe.replace(/^100,00;"H";"EUR";/, '106,00;"H";"USD";').replace('"Steuerbetrag";15,97;', '"Steuerbetrag";;').replace('"Nettobetrag";84,03;', '"Nettobetrag";100,00;');
    const data = ok(read({ [STAPEL]: stapel(usd), [EINGANG]: eingangDoc() }));
    expect(data.vouchers[0]).toMatchObject({ currency: "USD", amount: 10000, foreignAmount: 10600 });
  });

  it("lässt den Betrag bei Fremdwährung ohne Beleginfo in Fremdwährung und meldet das", () => {
    const usd = ausgabe.replace(/^100,00;"H";"EUR";/, '106,00;"H";"USD";').replace('"Steuerbetrag";15,97;', '"Steuerbetrag";;').replace('"Nettobetrag";84,03;', '"Nettobetrag";;');
    const data = ok(read({ [STAPEL]: stapel(usd), [EINGANG]: eingangDoc() }));
    expect(data.vouchers[0]).toMatchObject({ currency: "USD", amount: 10600, foreignAmount: 10600 });
    expect(data.hints.filter((h) => h.includes("nicht in Euro umgerechnet"))).toHaveLength(1);
  });

  it("nimmt den Kontenrahmen aus dem Kopf, sonst aus den Einstellungen", () => {
    const data = ok(read({ [STAPEL]: stapel(rechnung), [AUSGANG]: ausgangDoc() }));
    expect(data.stacks[0]!.kontenrahmen).toBe("SKR03");
    const skr04 = ok(readSevdeskExport(zip({ [STAPEL]: stapel(rechnung), [AUSGANG]: ausgangDoc() }), { kontenrahmen: "SKR04" }));
    // 8400 liegt in SKR04 im Bereich der Erlöse (4000–4999) nicht; die Richtung kommt dann allein aus document.xml
    expect(skr04.vouchers[0]).toMatchObject({ direction: "ausgang", directionFrom: "document", accountKind: null });
  });
});

describe("andere ZIP-Dateien", () => {
  const reason = (result: SevExportResult) => (result.ok ? null : result.reason);

  it("lehnt Bytes ab, die keine ZIP sind", () => {
    expect(reason(readSevdeskExport(strToU8("kein Archiv"), { kontenrahmen: "SKR03" }))).toMatch(/keine ZIP-Datei/);
  });

  it("lehnt eine ZIP ohne Buchungsstapel ab", () => {
    expect(reason(read({ "rechnung.pdf": strToU8("%PDF") }))).toMatch(/EXTF_Buchungsstapel/);
  });

  it("lehnt den Export von Accountable ab: Stapel mit Belege.zip, ohne Stammdaten und Rechnungsordner", () => {
    const belege = zipSync({ "document.xml": fixture("buchhaltung-1.0/document-rechnungseingang.xml") });
    expect(reason(read({ "datev_skr03_2025/EXTF_Buchungsstapel_2025.csv": unmaskedStack10(), "datev_skr03_2025/Belege.zip": belege }))).toMatch(
      /sieht nicht nach dem Export/,
    );
  });

  it("lehnt document.xml eines anderen Programms ab", () => {
    const xml = new TextDecoder()
      .decode(fixture("buchhaltung-2.0/document-rechnungsausgang.xml"))
      .replace('generatingSystem="sevDesk"', 'generatingSystem="Fremd"');
    expect(reason(read({ [STAPEL]: stapel(rechnung), [AUSGANG]: innerZip(strToU8(xml)) }))).toMatch(/erzeugt von „Fremd“/);
  });

  it("lehnt einen beschädigten Buchungsstapel mit Grund ab", () => {
    expect(reason(read({ [STAPEL]: strToU8("EXTF;700;21\n"), [AUSGANG]: ausgangDoc() }))).toMatch(new RegExp(`^${STAPEL}: `));
  });
});

describe("Grenzen beim Entpacken (Zip-Bombe)", () => {
  const nullen = new Uint8Array(4 * 1024 * 1024);

  it("lehnt eine Datei ab, die entpackt über der Grenze liegt", () => {
    const archive = zipSync({ [STAPEL]: stapel(rechnung), "DATEV_Rechnungsausgang_x.zip": nullen }, { level: 9 });
    expect(archive.length).toBeLessThan(64 * 1024);
    const result = readSevdeskExport(archive, { kontenrahmen: "SKR03", limits: { maxUnpackedBytes: 1024 * 1024 } });
    expect(result).toEqual({ ok: false, reason: "Die ZIP-Datei ist entpackt größer als 1 MB." });
  });

  it("zählt die inneren ZIPs mit", () => {
    const inner = zipSync({ "document.xml": fixture("buchhaltung-2.0/document-rechnungsausgang.xml"), "gross.pdf": nullen }, { level: 9 });
    const result = read({ [STAPEL]: stapel(rechnung), [AUSGANG]: inner }, { maxUnpackedBytes: 1024 * 1024 });
    expect(result).toEqual({ ok: false, reason: "Die ZIP-Datei ist entpackt größer als 1 MB." });
  });

  it("lehnt zu viele Einträge ab, auch in inneren ZIPs", () => {
    const viele = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`beleg-${i}.pdf`, strToU8("x")]));
    const inner = zipSync({ "document.xml": fixture("buchhaltung-2.0/document-rechnungsausgang.xml"), ...viele });
    const result = read({ [STAPEL]: stapel(rechnung), [AUSGANG]: inner }, { maxEntries: 40 });
    expect(result).toEqual({ ok: false, reason: "Die ZIP-Datei hat mehr als 40 Einträge." });
  });

  it("bricht nach der Grenze für Einträge ab, auch wenn das Verzeichnis 100 Millionen nennt", () => {
    // 98 Bytes: nur das Ende einer ZIP64-Datei (Record, Locator, EOCD), deren Verzeichnis 100 Millionen Einträge nennt
    const ende = new Uint8Array(56 + 20 + 22);
    const view = new DataView(ende.buffer);
    view.setUint32(0, 0x06064b50, true);
    view.setUint32(32, 100_000_000, true);
    view.setUint32(56, 0x07064b50, true);
    view.setUint32(76, 0x06054b50, true);
    view.setUint16(84, 0xffff, true);
    view.setUint16(86, 0xffff, true);
    const start = performance.now();
    const result = readSevdeskExport(ende, { kontenrahmen: "SKR03" });
    const dauer = performance.now() - start;
    expect(result).toEqual({ ok: false, reason: "Die ZIP-Datei hat mehr als 20000 Einträge." });
    expect(dauer).toBeLessThan(1000);
  });
});
