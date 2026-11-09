import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { validateXML } from "xmllint-wasm";
import { collectionDateFor, isTargetDay, pain008, sepaDirectDebitProblems, type SepaDirectDebitOrder } from "./sepa-lastschrift.ts";

/*
 * Schemas für die Prüfung der Lastschriftdatei:
 * - ISO 20022 pain.008.001.08 (test-fixtures/sepa/pain.008.001.08.xsd): von iso20022.org, laut deren Nutzungsbedingungen
 *   frei weiterzugeben; übernommen aus raphaelm/python-sepaxml (Commit 0728809), SHA-256 7edf4e4c…
 * - Technical Validation Subset der Deutschen Kreditwirtschaft pain.008.001.08_GBIC_5.xsd (Anlage 3 des DFÜ-Abkommens,
 *   Version 3.9, Stand 01.04.2025; gilt mit Version 26.11 ab 15.11.2026 weiter): veröffentlicht auf ebics.de ohne
 *   Lizenzangabe, deshalb nicht im Repository. Der Test lädt es von einem festen Commit eines Projekts, das es unverändert
 *   führt (gleicher SHA-256 wie die Datei im ZIP DK-TVS_SEPA_GBIC_5zzglISO_Originale von ebics.de).
 */
const ISO_XSD = readFileSync(new URL("../test-fixtures/sepa/pain.008.001.08.xsd", import.meta.url), "utf8");
const DK_XSD_URL =
  "https://raw.githubusercontent.com/MeinGrundeinkommen/konfipay/f6e1704d5bc93e77b995f9c0e8ccb75b59baa544/spec/schemas/pain.008.001.08_GBIC_5.xsd";
const DK_XSD_SHA256 = "f0d9429a114f496d78644a0b734452aa0e33ad4ae082fcbf806923fe138ad754";

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

const order = (overrides: Partial<SepaDirectDebitOrder> = {}): SepaDirectDebitOrder => ({
  messageId: "HABEN-LS-0123456789ABCDEF",
  createdAt: "2026-11-09T10:15:00",
  creditor: { name: "Müller & Söhne IT", iban: "DE89 3704 0044 0532 0130 00", bic: "COBADEFFXXX" },
  creditorId: "DE98ZZZ09999999999",
  batches: [
    {
      paymentInfoId: "HABEN-LS-0123456789ABCDEF-1",
      scheme: "CORE",
      sequence: "FRST",
      collectionDate: "2026-11-16",
      transactions: [
        {
          endToEndId: "HABEN-AAAA000011112222",
          amount: 29_750,
          mandate: { reference: "KD-1042-01", signedOn: "2026-10-01" },
          debtor: { name: "Nordwerk Software GmbH", iban: "DE02120300000000202051" },
          remittance: "Rechnung 2026-041",
        },
      ],
    },
    {
      paymentInfoId: "HABEN-LS-0123456789ABCDEF-2",
      scheme: "CORE",
      sequence: "RCUR",
      collectionDate: "2026-11-16",
      transactions: [
        {
          endToEndId: "HABEN-BBBB000011112222",
          amount: 11_900,
          mandate: { reference: "AB-2023-07", signedOn: "2023-04-03" },
          debtor: { name: "Société Générale Café", iban: "FR1420041010050500013M02606", bic: "PSSTFRPPXXX" },
          remittance: "Rechnung 2026-042",
        },
        {
          endToEndId: "HABEN-CCCC000011112222",
          amount: 5_049,
          mandate: { reference: "RP 7 (Wartung)", signedOn: "2024-01-15" },
          debtor: { name: "Rheinpixel GmbH", iban: "DE02120300000000202051" },
          remittance: "Rechnung 2026-043",
        },
      ],
    },
  ],
  ...overrides,
});

describe("pain.008.001.08", () => {
  it("zählt Anzahl und Summe in Kopf und je Sammler", () => {
    const result = pain008(order());
    if (!result.ok) throw new Error(result.problems.join(", "));
    expect(result.numberOfTransactions).toBe(3);
    expect(result.controlSum).toBe(46_699);
    expect(result.xml).toContain(
      "<GrpHdr><MsgId>HABEN-LS-0123456789ABCDEF</MsgId><CreDtTm>2026-11-09T10:15:00</CreDtTm><NbOfTxs>3</NbOfTxs><CtrlSum>466.99</CtrlSum>",
    );
    expect(result.xml).toContain(
      "<PmtInfId>HABEN-LS-0123456789ABCDEF-1</PmtInfId><PmtMtd>DD</PmtMtd><BtchBookg>true</BtchBookg><NbOfTxs>1</NbOfTxs><CtrlSum>297.50</CtrlSum>",
    );
    expect(result.xml).toContain("<NbOfTxs>2</NbOfTxs><CtrlSum>169.49</CtrlSum>");
  });

  it("schreibt Verfahren, Sequenz, Fälligkeit, Gläubiger-ID und Mandat", () => {
    const result = pain008(order());
    if (!result.ok) throw new Error(result.problems.join(", "));
    expect(result.xml).toContain("<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm><SeqTp>FRST</SeqTp></PmtTpInf>");
    expect(result.xml).toContain("<SeqTp>RCUR</SeqTp>");
    expect(result.xml).toContain("<ReqdColltnDt>2026-11-16</ReqdColltnDt>");
    expect(result.xml).toContain("<Cdtr><Nm>Mueller + Soehne IT</Nm></Cdtr>");
    expect(result.xml).toContain(
      "<CdtrSchmeId><Id><PrvtId><Othr><Id>DE98ZZZ09999999999</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>",
    );
    expect(result.xml).toContain("<MndtRltdInf><MndtId>KD-1042-01</MndtId><DtOfSgntr>2026-10-01</DtOfSgntr></MndtRltdInf>");
    expect(result.xml).toContain("<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>");
    expect(result.xml).toContain("<DbtrAgt><FinInstnId><BICFI>PSSTFRPPXXX</BICFI></FinInstnId></DbtrAgt>");
    expect(result.xml).toContain("<Dbtr><Nm>Societe Generale Cafe</Nm></Dbtr>");
    expect(result.xml).toContain("<Ustrd>Rechnung 2026-041</Ustrd>");
  });

  it("B2B als Firmenlastschrift", () => {
    const [first] = order().batches;
    const result = pain008(order({ batches: [{ ...first!, scheme: "B2B" }] }));
    if (!result.ok) throw new Error(result.problems.join(", "));
    expect(result.xml).toContain("<LclInstrm><Cd>B2B</Cd></LclInstrm>");
  });

  it("meldet, was nicht passt", () => {
    const [first] = order().batches;
    const tx = first!.transactions[0]!;
    const problems = sepaDirectDebitProblems(
      order({
        creditorId: "DE97ZZZ09999999999",
        batches: [
          {
            ...first!,
            transactions: [
              { ...tx, debtor: { name: "Ohne Konto", iban: "" } },
              {
                ...tx,
                endToEndId: tx.endToEndId,
                amount: 0,
                debtor: { name: "Schweiz AG", iban: "CH9300762011623852957" },
                mandate: { reference: "Müller_1", signedOn: "2026-10-01" },
              },
            ],
          },
        ],
      }),
    );
    expect(problems).toEqual([
      "Gläubiger-ID: Die Prüfziffer der Gläubiger-ID stimmt nicht.",
      "Ohne Konto: IBAN fehlt",
      "Schweiz AG: Referenz HABEN-AAAA000011112222 kommt doppelt vor",
      "Schweiz AG: Betrag muss zwischen 0,01 und 999.999.999,99 € liegen",
      "Schweiz AG: Die Mandatsreferenz darf nur A–Z, a–z, 0–9, Leerzeichen und + ? / - : ( ) . , ' enthalten.",
      "Schweiz AG: Lastschriften zieht Haben nur von Konten im EWR ein",
    ]);
    expect(pain008(order({ batches: [] }))).toEqual({ ok: false, problems: ["Keine Lastschrift ausgewählt"] });
  });

  it("passt zum Schema von ISO 20022", async () => {
    const result = pain008(order());
    if (!result.ok) throw new Error(result.problems.join(", "));
    expect(await schemaErrors(result.xml, ISO_XSD)).toEqual([]);
  });

  it("passt zum Schema der Deutschen Kreditwirtschaft (GBIC_5), auch mit langen Texten und B2B", async (ctx) => {
    if (!dkXsd) return ctx.skip();
    const [first] = order().batches;
    const long = order({
      creditor: { name: `Ä${"x".repeat(200)}`, iban: "DE89370400440532013000" },
      batches: [
        {
          ...first!,
          scheme: "B2B",
          transactions: [
            {
              endToEndId: "HABEN-1",
              amount: 99_999_999_999,
              mandate: { reference: "A".repeat(35), signedOn: "2026-10-01" },
              debtor: { name: "ö".repeat(100), iban: "DE02120300000000202051" },
              remittance: "ü".repeat(200),
            },
          ],
        },
      ],
    });
    for (const o of [order(), long]) {
      const result = pain008(o);
      if (!result.ok) throw new Error(result.problems.join(", "));
      expect(await schemaErrors(result.xml, dkXsd)).toEqual([]);
    }
  });

  it("das Schema der DK fängt einen Fehler ab, den die Prüfung sonst übersieht (Gegenprobe)", async (ctx) => {
    if (!dkXsd) return ctx.skip();
    const result = pain008(order());
    if (!result.ok) throw new Error(result.problems.join(", "));
    expect(await schemaErrors(result.xml.replace("<SeqTp>FRST</SeqTp>", "<SeqTp>XXXX</SeqTp>"), dkXsd)).not.toEqual([]);
  });
});

describe("Fälligkeit der Lastschrift", () => {
  it("TARGET-Tage: Montag bis Freitag ohne Neujahr, Karfreitag, Ostermontag, 1. Mai, 25. und 26. Dezember", () => {
    expect(isTargetDay("2026-11-09")).toBe(true);
    expect(isTargetDay("2026-11-14")).toBe(false);
    expect(isTargetDay("2026-04-03")).toBe(false);
    expect(isTargetDay("2026-04-06")).toBe(false);
    expect(isTargetDay("2026-05-01")).toBe(false);
    expect(isTargetDay("2026-12-24")).toBe(true);
    expect(isTargetDay("2026-12-25")).toBe(false);
    expect(isTargetDay("2027-01-01")).toBe(false);
    // Kein TARGET-Feiertag, auch wenn in Bayern frei
    expect(isTargetDay("2026-01-06")).toBe(true);
  });

  it("Fälligkeit der Rechnung, wenn sie ein TARGET-Tag frühestens zwei TARGET-Tage nach heute ist", () => {
    expect(collectionDateFor("2026-11-16", "2026-11-09")).toBe("2026-11-16");
  });

  it("sonst der nächste passende TARGET-Tag", () => {
    // Fällig am Samstag: Montag
    expect(collectionDateFor("2026-11-14", "2026-11-09")).toBe("2026-11-16");
    // Schon fällig oder zu knapp: zwei TARGET-Tage nach heute (Freitag → Dienstag)
    expect(collectionDateFor("2026-11-02", "2026-11-13")).toBe("2026-11-17");
    // Über Weihnachten: 23.12. → 24.12., 28.12.
    expect(collectionDateFor("2026-12-20", "2026-12-23")).toBe("2026-12-28");
  });
});
