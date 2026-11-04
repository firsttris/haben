import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { validateXML } from "xmllint-wasm";
import { pain001, sepaAmount, sepaTransferProblems, type SepaTransferOrder } from "./sepa.ts";
import { isValidBic, isValidIban, sepaText } from "./sepa-text.ts";

/*
 * Schemas für die Prüfung:
 * - ISO 20022 pain.001.001.09 (test-fixtures/sepa/pain.001.001.09.xsd): von iso20022.org, laut deren Nutzungsbedingungen
 *   frei weiterzugeben; übernommen aus raphaelm/python-sepaxml (Commit 0728809), SHA-256 de038b37…
 * - Technical Validation Subset der Deutschen Kreditwirtschaft pain.001.001.09_GBIC_5.xsd (Anlage 3 des DFÜ-Abkommens,
 *   Version 3.9, Stand 01.04.2025): veröffentlicht auf ebics.de, ohne Angabe einer Lizenz. Deshalb nicht im Repository;
 *   der Test lädt ihn aus einem Projekt, das ihn unverändert führt, und prüft den SHA-256.
 */
const ISO_XSD = readFileSync(new URL("../test-fixtures/sepa/pain.001.001.09.xsd", import.meta.url), "utf8");
const DK_XSD_URL =
  "https://raw.githubusercontent.com/MeinGrundeinkommen/konfipay/f6e1704d5bc93e77b995f9c0e8ccb75b59baa544/spec/schemas/pain.001.001.09_GBIC_5.xsd";
const DK_XSD_SHA256 = "d64da6e1553cf8dd38f98818fe3234fb79daec792d0a69483a1ab8e90dec8b8c";

let dkXsd: string | null = null;

beforeAll(async () => {
  try {
    const response = await fetch(DK_XSD_URL, { signal: AbortSignal.timeout(20_000) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (response.ok && createHash("sha256").update(bytes).digest("hex") === DK_XSD_SHA256) dkXsd = new TextDecoder().decode(bytes);
  } catch {
    dkXsd = null;
  }
  // In der CI muss das Schema der DK da sein; lokal ohne Netz wird die Prüfung übersprungen
  if (!dkXsd && process.env.CI) throw new Error(`Schema der DK nicht geladen: ${DK_XSD_URL}`);
}, 30_000);

async function schemaErrors(xml: string, xsd: string): Promise<string[]> {
  const result = await validateXML({ xml: { fileName: "pain.xml", contents: xml }, schema: { fileName: "pain.xsd", contents: xsd } });
  return result.errors.map((e) => e.message);
}

const order = (overrides: Partial<SepaTransferOrder> = {}): SepaTransferOrder => ({
  messageId: "HABEN-0123456789ABCDEF",
  paymentInfoId: "HABEN-0123456789ABCDEF-1",
  createdAt: "2026-11-04T10:15:00",
  executionDate: "2026-11-05",
  debtor: { name: "Muster Design GmbH", iban: "DE89 3704 0044 0532 0130 00", bic: "COBADEFFXXX" },
  transactions: [
    {
      endToEndId: "HABEN-AAAA000011112222",
      amount: 11_900,
      creditor: { name: "Büro & Bedarf Müller GmbH", iban: "DE02120300000000202051" },
      remittance: "RE-2026-0815",
    },
    {
      endToEndId: "HABEN-BBBB000011112222",
      amount: 5_049,
      creditor: { name: "Société Générale Café", iban: "FR1420041010050500013M02606", bic: "PSSTFRPPXXX" },
      remittance: "Rechnung 4711 / Kunde 42",
    },
  ],
  ...overrides,
});

describe("Zeichensatz", () => {
  it("schreibt Umlaute aus und nimmt Akzente weg", () => {
    expect(sepaText("Büro & Bedarf Müller GmbH", 70)).toBe("Buero + Bedarf Mueller GmbH");
    expect(sepaText("Straße Öl Ärger Übel", 70)).toBe("Strasse Oel Aerger Uebel");
    expect(sepaText("Société Générale Café", 70)).toBe("Societe Generale Cafe");
  });

  it("ersetzt Zeichen außerhalb des Latin-Zeichensatzes und fasst Leerraum zusammen", () => {
    expect(sepaText('info@firma.de 100 € \n Rechnung_1; "neu" <b>', 140)).toBe("info(at)firma.de 100 E Rechnung-1 neu b");
    expect(sepaText("  a\t\tb  ", 140)).toBe("a b");
  });

  it("kürzt auf die Länge des Feldes, gezählt nach dem Ausschreiben", () => {
    expect(sepaText("ä".repeat(40), 70)).toHaveLength(70);
    expect(sepaText("ab c", 3)).toBe("ab");
  });

  it("lässt nur Zeichen des Latin-Zeichensatzes übrig", () => {
    const all = Array.from({ length: 0x250 }, (_, i) => String.fromCharCode(i)).join("");
    expect(sepaText(all, 10_000)).toMatch(/^[A-Za-z0-9/\-?:().,'+ ]*$/);
  });
});

describe("IBAN und BIC", () => {
  it("prüft Form und Prüfziffer der IBAN", () => {
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("de89370400440532013000")).toBe(true);
    expect(isValidIban("DE88370400440532013000")).toBe(false);
    expect(isValidIban("DE8937040044")).toBe(false);
    expect(isValidIban("")).toBe(false);
  });

  it("prüft die BIC mit 8 oder 11 Zeichen", () => {
    expect(isValidBic("COBADEFF")).toBe(true);
    expect(isValidBic("COBADEFFXXX")).toBe(true);
    expect(isValidBic("COBADEF")).toBe(false);
    expect(isValidBic("COBA1EFFXXX")).toBe(false);
  });
});

describe("pain.001.001.09", () => {
  it("zählt Anzahl und Summe in Kopf und Auftrag", () => {
    const result = pain001(order());
    if (!result.ok) throw new Error(result.problems.join(", "));
    expect(result.numberOfTransactions).toBe(2);
    expect(result.controlSum).toBe(16_949);
    expect(result.xml.match(/<NbOfTxs>2<\/NbOfTxs>/g)).toHaveLength(2);
    expect(result.xml.match(/<CtrlSum>169\.49<\/CtrlSum>/g)).toHaveLength(2);
    expect(result.xml).toContain('<InstdAmt Ccy="EUR">119.00</InstdAmt>');
    expect(result.xml).toContain('<InstdAmt Ccy="EUR">50.49</InstdAmt>');
  });

  it("schreibt Namen, IBAN, BIC und Verwendungszweck", () => {
    const result = pain001(order());
    if (!result.ok) throw new Error(result.problems.join(", "));
    expect(result.xml).toContain("<Nm>Buero + Bedarf Mueller GmbH</Nm>");
    expect(result.xml).toContain("<IBAN>DE89370400440532013000</IBAN>");
    expect(result.xml).toContain("<DbtrAgt><FinInstnId><BICFI>COBADEFFXXX</BICFI></FinInstnId></DbtrAgt>");
    expect(result.xml).toContain("<CdtrAgt><FinInstnId><BICFI>PSSTFRPPXXX</BICFI></FinInstnId></CdtrAgt>");
    expect(result.xml).toContain("<Ustrd>RE-2026-0815</Ustrd>");
    expect(result.xml).toContain("<EndToEndId>HABEN-AAAA000011112222</EndToEndId>");
    expect(result.xml).toContain("<BtchBookg>false</BtchBookg>");
    expect(result.xml).toContain("<ReqdExctnDt><Dt>2026-11-05</Dt></ReqdExctnDt>");
  });

  it("schreibt ohne BIC des Auftraggebers NOTPROVIDED", () => {
    const result = pain001(order({ debtor: { name: "Muster", iban: "DE89370400440532013000" } }));
    if (!result.ok) throw new Error(result.problems.join(", "));
    expect(result.xml).toContain("<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>");
  });

  it("meldet fehlende und ungültige IBAN, doppelte Referenzen und unpassende Beträge", () => {
    const [first, second] = order().transactions;
    const problems = sepaTransferProblems(
      order({
        transactions: [
          { ...first!, creditor: { name: "Ohne Konto", iban: "" } },
          { ...second!, endToEndId: first!.endToEndId, amount: 0, creditor: { name: "Tippfehler", iban: "DE88370400440532013000" } },
        ],
      }),
    );
    expect(problems).toEqual([
      "Ohne Konto: IBAN fehlt",
      "Tippfehler: Referenz HABEN-AAAA000011112222 kommt doppelt vor",
      "Tippfehler: Betrag muss zwischen 0,01 und 999.999.999,99 € liegen",
      "Tippfehler: IBAN DE88370400440532013000 ist ungültig",
    ]);
    expect(pain001(order({ transactions: [] }))).toEqual({ ok: false, problems: ["Keine Überweisung ausgewählt"] });
  });

  it("lehnt Kennungen außerhalb des Schemas ab", () => {
    expect(sepaTransferProblems(order({ messageId: "Ä".repeat(3) }))).toEqual(["MsgId ÄÄÄ passt nicht zum Schema"]);
    expect(sepaTransferProblems(order({ paymentInfoId: "x".repeat(36) }))).toHaveLength(1);
  });

  it("schreibt Beträge mit Punkt und zwei Nachkommastellen", () => {
    expect(sepaAmount(1)).toBe("0.01");
    expect(sepaAmount(100)).toBe("1.00");
    expect(sepaAmount(99_999_999_999)).toBe("999999999.99");
  });

  it("passt zum Schema von ISO 20022", async () => {
    const result = pain001(order());
    if (!result.ok) throw new Error(result.problems.join(", "));
    expect(await schemaErrors(result.xml, ISO_XSD)).toEqual([]);
  });

  it("passt zum Schema der Deutschen Kreditwirtschaft (GBIC_5), auch mit langen Texten", async (ctx) => {
    if (!dkXsd) return ctx.skip();
    const long = order({
      debtor: { name: `Ä${"x".repeat(200)}`, iban: "DE89370400440532013000" },
      transactions: [
        { endToEndId: "HABEN-1", amount: 99_999_999_999, creditor: { name: "ö".repeat(100), iban: "DE02120300000000202051" }, remittance: "ü".repeat(200) },
      ],
    });
    for (const o of [order(), long]) {
      const result = pain001(o);
      if (!result.ok) throw new Error(result.problems.join(", "));
      expect(await schemaErrors(result.xml, dkXsd)).toEqual([]);
    }
  });

  it("das Schema der DK fängt einen Fehler ab, den die Prüfung sonst übersieht (Gegenprobe)", async (ctx) => {
    if (!dkXsd) return ctx.skip();
    const result = pain001(order());
    if (!result.ok) throw new Error(result.problems.join(", "));
    expect(await schemaErrors(result.xml.replace('Ccy="EUR">119.00', 'Ccy="USD">119.00'), dkXsd)).not.toEqual([]);
  });
});
