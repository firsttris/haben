import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Das Repository ist öffentlich: Jede Datei unter test-fixtures/sevdesk muss anonym sein. Die Prüfung schlägt an, wenn
 * ein neues Feld oder eine neue Datei etwas anderes trägt als einen Platzhalter oder einen hier ausdrücklich erlaubten
 * erfundenen Wert. Keine echten Werte oder Vergleichslisten hier eintragen.
 */

const WURZEL = fileURLToPath(new URL("../../test-fixtures/sevdesk/", import.meta.url));
const ANON = "<anon>";

const dateien = (ordner: string): string[] =>
  readdirSync(ordner).flatMap((name) => {
    const pfad = join(ordner, name);
    return statSync(pfad).isDirectory() ? dateien(pfad) : [pfad];
  });
const relativ = (pfad: string) => pfad.slice(WURZEL.length).replaceAll("\\", "/");

const erlaubtInText = new Set(["DE00000000000000000000", "DE000000000"]);
const MUSTER = [
  ["E-Mail", /[\w.+-]+@[\w-]+\.[\w.-]+/g],
  ["IBAN", /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g],
  ["USt-IdNr.", /\bDE\d{9}\b/g],
] as const;

/** E-Mail-Adresse, IBAN oder USt-IdNr. irgendwo im Text der Datei */
function pruefeMuster(datei: string, inhalt: string): string[] {
  return MUSTER.flatMap(([art, muster]) =>
    [...inhalt.matchAll(muster)].filter(([treffer]) => !erlaubtInText.has(treffer)).map(([treffer]) => `${datei}: ${art} ${treffer}`),
  );
}

const nurAnon = new Set([ANON]);
const mit = (...werte: string[]) => new Set([ANON, ...werte]);

/** Belegnummern aus den Testdaten; maskiert oder erfunden, jede einzeln benannt */
const BELEGNUMMERN = [
  "XX-1111-11-1111",
  "11111111-11111112",
  "X11111111113",
  "11111111-11111114XXXXXXXXXXXXXXXXX",
  "XX-XX-1111111111-1111-15",
  "RE-0001",
  "RE-0003",
  "RE-2024-0001",
  "RE-2024-0002",
  "B-2024-0001",
  "B-2024-0002",
  "B-2024-0003",
  "B-2024-0004",
];
const VORLAGEN_TEXTE = ["<anon> [%Rechnungsnummer%]", "<anon> [%KONTAKTPERSON%]", "<anon> [%ZAHLUNGSZIEL%] [%KONTAKTPERSON%]"];

/** Sensible JSON-Felder mit den einzigen erlaubten Werten; leer ist immer erlaubt */
const FELDER: Record<string, Set<string>> = {
  ...Object.fromEntries(
    [
      "surename",
      "familyname",
      "name2",
      "address",
      "addressName",
      "addressName2",
      "addressParentName",
      "addressParentName2",
      "addressStreet",
      "addressCity",
      "supplierName",
      "supplierNameAtSave",
      "vatNumber",
      "customerNumber",
      "customerInternalNote",
      "comment",
      "text",
      "headText",
      "filename",
      "iban",
      "bankAccount",
      "bankNumber",
      "sepaPayerIban",
      "sepaCreditorId",
      "creditNoteNumber",
      "orderNumber",
      "financeAuthorityTicketNumber",
      "einvoiceReference",
      "sepaMandateReference",
    ].map((feld) => [feld, nurAnon]),
  ),
  addressZip: mit("1"),
  taxNumber: mit("1"),
  header: mit(...VORLAGEN_TEXTE),
  footText: mit(...VORLAGEN_TEXTE),
  invoiceNumber: mit("1", ...BELEGNUMMERN),
  description: mit(...BELEGNUMMERN),
  paymtPurpose: mit("Rechnung RE-0001", "Rechnung RE-0003"),
  payeePayerName: mit("Kunde GmbH"),
  payeePayerAcctNo: mit("DE00000000000000000000"),
  payeePayerBankCode: mit("XXXXDEXX"),
  entryText: new Set(["SEPA Gutschrift (EinzelbuchungHaben)"]),
};

/** Bei diesen Objekten ist `name` ein Name aus dem Kontenrahmen von sevDesk und bleibt */
const NAME_FREI = new Set(["AccountingType", "AccountDatev", "AccountCategory", "AccountDatevCategory", "AccountingChart", "TaxRule", "Category", "Unity"]);

/** reportingValues: Kennzahlen als JSON-Text; nur Platzhalterbeträge 0 und ±100 sind erlaubt */
function platzhalterKennzahlen(inhalt: unknown): boolean {
  if (inhalt === ANON) return true;
  try {
    const werte = JSON.parse(String(inhalt)) as Record<string, unknown>;
    return Object.values(werte).every((w) => [0, 100, -100].includes(Number(w)));
  } catch {
    return false;
  }
}

function pruefeJson(datei: string, wert: unknown): string[] {
  if (Array.isArray(wert)) return wert.flatMap((w) => pruefeJson(datei, w));
  if (!wert || typeof wert !== "object") return [];
  const objekt = wert as Record<string, unknown>;
  return Object.entries(objekt).flatMap(([feld, inhalt]) => {
    if (inhalt && typeof inhalt === "object") return pruefeJson(datei, inhalt);
    if (inhalt === null || inhalt === "") return [];
    if (feld === "reportingValues") return platzhalterKennzahlen(inhalt) ? [] : [`${datei}: ${feld} = ${String(inhalt)}`];
    const erlaubt = feld === "name" ? (NAME_FREI.has(String(objekt.objectName)) ? null : nurAnon) : FELDER[feld];
    return erlaubt && !(typeof inhalt === "string" && erlaubt.has(inhalt)) ? [`${datei}: ${feld} = ${String(inhalt)}`] : [];
  });
}

/** Trennt eine CSV-Datei mit Semikolon; "" steht für ein Anführungszeichen im Feld. */
function csvZeilen(text: string): string[][] {
  const zeilen: string[][] = [];
  let zeile: string[] = [];
  let feld = "";
  let inAnfuehrung = false;
  for (let i = 0; i < text.length; i++) {
    const zeichen = text[i]!;
    if (inAnfuehrung) {
      if (zeichen !== '"') feld += zeichen;
      else if (text[i + 1] === '"') feld += text[++i];
      else inAnfuehrung = false;
    } else if (zeichen === '"') inAnfuehrung = true;
    else if (zeichen === ";") {
      zeile.push(feld);
      feld = "";
    } else if (zeichen === "\n") {
      zeile.push(feld.replace(/\r$/, ""));
      zeilen.push(zeile);
      zeile = [];
      feld = "";
    } else feld += zeichen;
  }
  if (feld || zeile.length) zeilen.push([...zeile, feld]);
  return zeilen;
}

/** Belegnummern aus buchhaltung-2.0/, maskiert und je Beleg einzeln benannt; nur dort erlaubt */
const BELEGNUMMERN_2_0 = [
  "XX-1111111111",
  "XX-1111111113",
  "XX-1111111114",
  "1111111111111111112",
  "1111111111111111115",
  "1111111111111111116",
  "-XX-XXX-11-11111-1111111-11111-11111",
  "XX-1111111117",
  "XX-1111111118",
];

/** Nur in buchhaltung-2.0/extf-buchungsstapel.csv: die Beispielzeilen aus dem Bericht */
const BERICHT_2_0 = {
  buchungstext: ["Lieferant GmbH, EBA-BG-EUR-xx-xxxxx-xxxxx xx-xxxxx-xxxxx", "Zahlung zu EBA-SG-EUR-THRFS INVOICE-xxxxxxxxxxxxx_11"],
  belegfeld: ["-BG-EUR-xx-xxxxx-xxxxxxx-xxxxx-xxxxx", "00000000-0000-4000-8000-000000000001"],
};
const CSV_SPALTE_ANON =
  /^(Name|Straße|Postleitzahl|Ort|E-Mail|Internet|EU-UStId|Telefon|Kurzbezeichnung|Kontoinhaber|IBAN|Zusatzinformation.*Inhalt|SEPA-Mandatsreferenz|Gesellschaftername)|UStId|USt-Id/i;
/** Beleginfo-Inhalt N trägt das, was Beleginfo-Art N nennt; alles außer diesen Arten gilt als sensibel. */
const BELEGINFO_OHNE_PERSONENBEZUG = new Set(["Umsatzsteuerprozent", "Nettobetrag", "Steuerbetrag", "Leistungsdatum"]);

function erlaubtInSpalte(spalte: string, version2: boolean): Set<string> | null {
  if (spalte === "Buchungstext") return mit("Zahlung <anon>", "Abschreibungen <anon>", ...(version2 ? BERICHT_2_0.buchungstext : []));
  if (spalte === "Belegfeld 1") return mit(...BELEGNUMMERN, ...(version2 ? [...BERICHT_2_0.belegfeld, ...BELEGNUMMERN_2_0] : []));
  return CSV_SPALTE_ANON.test(spalte) ? nurAnon : null;
}

function pruefeCsv(datei: string, text: string): string[] {
  const [, kopf, ...zeilen] = csvZeilen(text);
  return zeilen.flatMap((zeile) =>
    zeile.flatMap((inhalt, i) => {
      const spalte = kopf?.[i] ?? "";
      const beleginfo = /^Beleginfo-Inhalt (\d+)$/.exec(spalte);
      if (beleginfo && BELEGINFO_OHNE_PERSONENBEZUG.has(zeile[kopf!.indexOf(`Beleginfo-Art ${beleginfo[1]}`)] ?? "")) return [];
      const erlaubt = beleginfo ? nurAnon : erlaubtInSpalte(spalte, datei.startsWith("buchhaltung-2.0/"));
      return inhalt && erlaubt && !erlaubt.has(inhalt) ? [`${datei}: ${spalte} = ${inhalt}`] : [];
    }),
  );
}

/** Dateinamen in document.xml: festes Datum, erfundene Nummer, Kennung aus Nullen */
function pruefeXml(datei: string, text: string): string[] {
  return [...text.matchAll(/<extension name="([^"]*)"/g)].flatMap(([, name]) => {
    const treffer = /^2024-01-15_[A-Za-z]+_(.+)_0{32}\.pdf$/.exec(name!);
    const nummern = datei.startsWith("buchhaltung-2.0/") ? [...BELEGNUMMERN, ...BELEGNUMMERN_2_0] : BELEGNUMMERN;
    return treffer && nummern.includes(treffer[1]!) ? [] : [`${datei}: Dateiname ${name}`];
  });
}

function lesen(pfad: string): string {
  const bytes = readFileSync(pfad);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function pruefeDatei(datei: string, text: string): string[] {
  const befunde = pruefeMuster(datei, text);
  if (datei.endsWith(".json")) return [...befunde, ...pruefeJson(datei, JSON.parse(text))];
  if (datei.endsWith(".csv")) return [...befunde, ...pruefeCsv(datei, text)];
  if (datei.endsWith(".xml")) return [...befunde, ...pruefeXml(datei, text)];
  return [...befunde, `${datei}: unbekannte Dateiart, Prüfung ergänzen`];
}

describe("Testdaten von sevDesk sind anonym", () => {
  const alle = dateien(WURZEL).filter((pfad) => !pfad.endsWith("README.md"));

  it("findet die Dateien", () => {
    expect(alle.length).toBeGreaterThan(20);
  });

  it.each(alle.map((pfad) => [relativ(pfad), pfad] as const))("%s", (datei, pfad) => {
    expect(pruefeDatei(datei, lesen(pfad))).toEqual([]);
  });
});

describe("Gegenprobe der Anonymisierungsprüfung mit erfundenen Werten", () => {
  it.each([
    ["E-Mail", "Kontakt: erika.mustermann@example.org"],
    ["IBAN", "DE89370400440532013000"],
    ["USt-IdNr.", "DE123456789"],
  ])("erkennt %s im Text", (art, inhalt) => {
    expect(pruefeMuster("x.json", inhalt)).toEqual([expect.stringContaining(art)]);
  });

  it("lässt nur die benannten Platzhalter in IBAN und USt-IdNr. zu", () => {
    expect(pruefeMuster("x.json", "DE00000000000000000000 DE000000000")).toEqual([]);
  });

  it.each([
    ["supplierName", "Erika Mustermann"],
    ["addressStreet", "Musterweg 1"],
    ["taxNumber", "12/345/67890"],
    ["vatNumber", "DE123456789"],
    ["paymtPurpose", "Rechnung 4711"],
    ["payeePayerName", "Max Beispiel"],
    ["invoiceNumber", "RE-4711"],
    ["description", "2024-4711"],
  ])("meldet %s mit echtem Wert", (feld, inhalt) => {
    expect(pruefeJson("x.json", { [feld]: inhalt })).toHaveLength(1);
  });

  it("meldet einen Namen außerhalb des Kontenrahmens, nicht aber ein Buchungskonto", () => {
    expect(pruefeJson("x.json", { objectName: "InvoicePos", name: "Beratung Mustermann" })).toHaveLength(1);
    expect(pruefeJson("x.json", { objectName: "AccountingType", name: "Wareneingang" })).toEqual([]);
  });

  it("lässt Platzhalter und leere Felder zu und prüft verschachtelt", () => {
    expect(pruefeJson("x.json", { supplierName: ANON, address: null, addressCity: "" })).toEqual([]);
    expect(pruefeJson("x.json", { origin: { items: [{ addressCity: "Musterstadt" }] } })).toHaveLength(1);
  });

  it("meldet in der CSV echte Werte je Spalte, Platzhalter nicht", () => {
    const stamm = "EXTF;700;16\nName (Adressatentyp Unternehmen);Ort;E-Mail\nMuster AG;<anon>;<anon>\n";
    expect(pruefeCsv("buchhaltung-1.0/x.csv", stamm)).toEqual(["buchhaltung-1.0/x.csv: Name (Adressatentyp Unternehmen) = Muster AG"]);
    const stapel = "EXTF;700;21\nBuchungstext;Belegfeld 1\nMiete Musterweg;RE-4711\n<anon>;RE-0001\n";
    expect(pruefeCsv("buchhaltung-1.0/x.csv", stapel)).toHaveLength(2);
  });

  it("meldet eine USt-IdNr. auch in Spalten, deren Name anders beginnt", () => {
    const zeilen = "EXTF\nEU-Mitgliedstaat u. UStID (Ursprung)\nDE123456789\n<anon>\n";
    expect(pruefeCsv("buchhaltung-2.0/x.csv", zeilen)).toEqual(["buchhaltung-2.0/x.csv: EU-Mitgliedstaat u. UStID (Ursprung) = DE123456789"]);
  });

  it("prüft Beleginfo-Inhalt nach der genannten Art", () => {
    const zeilen = "EXTF\nBeleginfo-Art 1;Beleginfo-Inhalt 1\nName;Muster AG\nNettobetrag;100,00\nUnbekannt;Wert\n";
    expect(pruefeCsv("buchhaltung-1.0/x.csv", zeilen)).toEqual([
      "buchhaltung-1.0/x.csv: Beleginfo-Inhalt 1 = Muster AG",
      "buchhaltung-1.0/x.csv: Beleginfo-Inhalt 1 = Wert",
    ]);
  });

  it("erlaubt die Beispielzeilen des Berichts nur in Version 2.0", () => {
    const text = `EXTF\nBuchungstext\n${BERICHT_2_0.buchungstext[0]}\n`;
    expect(pruefeCsv("buchhaltung-2.0/x.csv", text)).toEqual([]);
    expect(pruefeCsv("buchhaltung-1.0/x.csv", text)).toHaveLength(1);
  });

  it("meldet in document.xml Dateinamen mit echter Nummer", () => {
    expect(pruefeXml("x.xml", `<extension name="2024-01-15_Rechnung_RE-0001_${"0".repeat(32)}.pdf"`)).toEqual([]);
    expect(pruefeXml("x.xml", `<extension name="2024-03-07_Rechnung_RE-4711_${"a".repeat(32)}.pdf"`)).toHaveLength(1);
  });

  it("erlaubt die maskierten Nummern aus Version 2.0 nur dort", () => {
    const name = `<extension name="2024-01-15_Rechnung_${BELEGNUMMERN_2_0[0]}_${"0".repeat(32)}.pdf"`;
    expect(pruefeXml("buchhaltung-2.0/x.xml", name)).toEqual([]);
    expect(pruefeXml("buchhaltung-1.0/x.xml", name)).toHaveLength(1);
  });

  it("meldet eine unbekannte Dateiart", () => {
    expect(pruefeDatei("x.txt", "")).toEqual([expect.stringContaining("unbekannte Dateiart")]);
  });
});

describe("Gegenprobe für Felder aus Version 2.0 mit erfundenen Werten", () => {
  it.each([
    ["financeAuthorityTicketNumber", "ET-4711-0815"],
    ["reportingValues", '{"Kz81":"12345.67"}'],
    ["einvoiceReference", "04011000-12345-67"],
    ["sepaMandateReference", "MANDAT-MUSTERMANN-1"],
  ])("meldet %s, wie der Kopf der Datei verspricht", (feld, wert) => {
    expect(pruefeJson("buchhaltung-2.0/x.json", { objectName: "VatReport", [feld]: wert })).toHaveLength(1);
  });

  it("meldet SEPA-Mandatsreferenz und Gesellschaftername im DATEV-Stapel", () => {
    const zeilen = "EXTF\nSEPA-Mandatsreferenz;Gesellschaftername\nMANDAT-MUSTERMANN-1;Erika Mustermann\n";
    expect(pruefeCsv("buchhaltung-2.0/x.csv", zeilen)).toHaveLength(2);
  });
});

describe("Platzhalterbeträge in reportingValues", () => {
  it("lässt 0 und ±100 zu, sonst nichts", () => {
    expect(pruefeJson("x.json", { reportingValues: '{"41":0,"66":"100.00","81":-100}' })).toEqual([]);
    expect(pruefeJson("x.json", { reportingValues: '{"81":"119.00"}' })).toHaveLength(1);
    expect(pruefeJson("x.json", { reportingValues: "kein JSON" })).toHaveLength(1);
  });
});
