import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import type { Kontenrahmen } from "../../datev.ts";
import { archiveVoucherOf } from "./archivbeleg.ts";
import { readSevdeskExport } from "./leser.ts";
import { fixture, innerZip, zip } from "./testzip.ts";
import type { SevExport } from "./types.ts";

/*
 * Exportbelege als Archivbelege, aus den Testdaten in test-fixtures/sevdesk und daraus abgeleiteten Zeilen. SKR04 entsteht
 * aus denselben Zeilen mit den Konten des SKR04 (Erlöse 4400, Aufwand 6300, Darlehen 3150).
 */

const STAPEL = "EXTF_Buchungsstapel_20240101_20241231.csv";
const AUSGANG = "DATEV_Rechnungsausgang_20240101_20241231.zip";
const EINGANG = "DATEV_Rechnungseingang_20240101_20241231.zip";

/** Zeilen des Auszugs aus 2.0: Kopf, Spalten, Rechnung (8400 H), Ausgabebeleg (4985 S, BU 9), Zahlung, Gutschrift (8400 S) */
const [kopf, spalten, rechnung, ausgabe, , gutschrift] = new TextDecoder()
  .decode(fixture("buchhaltung-2.0/extf-buchungsstapel-auszug.csv"))
  .split("\n") as string[];
const ohneBeleglink = (zeile: string) => zeile.replace(/"BEDI ""[^"]+"""/, "");

const KONTEN: Record<Kontenrahmen, { erloes: string; aufwand: string; darlehen: string }> = {
  SKR03: { erloes: "8400", aufwand: "4985", darlehen: "0630" },
  SKR04: { erloes: "4400", aufwand: "6300", darlehen: "3150" },
};

function lese(kontenrahmen: Kontenrahmen, zeilen: string[]): SevExport {
  const { erloes, aufwand } = KONTEN[kontenrahmen];
  const umgestellt = zeilen.map((z) => z.replace(";8400;", `;${erloes};`).replace(";4985;", `;${aufwand};`));
  const result = readSevdeskExport(
    zip({
      [STAPEL]: strToU8([kopf, spalten, ...umgestellt].join("\n")),
      [AUSGANG]: innerZip(fixture("buchhaltung-2.0/document-rechnungsausgang.xml")),
      [EINGANG]: innerZip(fixture("buchhaltung-2.0/document-rechnungseingang.xml")),
    }),
    { kontenrahmen },
  );
  if (!result.ok) throw new Error(result.reason);
  return result.export;
}

const archiv = (data: SevExport) => data.vouchers.map((v) => archiveVoucherOf(data, v));

describe.each(["SKR03", "SKR04"] as const)("Exportbelege als Archivbelege (%s)", (kontenrahmen) => {
  const { darlehen } = KONTEN[kontenrahmen];

  it("Rechnung, Ausgabebeleg und Gutschrift auf dem Erlöskonto, Netto und Steuer aus Beleginfo oder dem Automatikkonto", () => {
    const [r, a, g] = archiv(lese(kontenrahmen, [rechnung!, ausgabe!, gutschrift!]));
    expect(r).toMatchObject({
      externalId: "sevdesk-export/00000000-0000-4000-8000-000000000001",
      type: "salesinvoice",
      direction: "einnahme",
      accountKind: "erloese",
      gross: 10000,
      net: 8403,
      tax: 1597,
      rate: 1900,
      contactName: "<anon>",
    });
    expect(a).toMatchObject({ type: "purchaseinvoice", direction: "ausgabe", accountKind: "aufwand", gross: 10000, net: 8403, tax: 1597, rate: 1900 });
    // Beleginfo ohne Netto und Steuer: Steuer aus dem Automatikkonto (8400 bzw. 4400, 19 %)
    expect(g).toMatchObject({ type: "salescreditnote", direction: "einnahme", gross: -10000, net: -8403, tax: -1597, rate: 1900 });
  });

  it("Darlehen erhalten (Sachkonto im Haben): Einnahme mit positivem Betrag, ohne Steuer, Konto weder Erlös noch Aufwand", () => {
    const zeile = ohneBeleglink(ausgabe!)
      .replace(/^100,00;"H"/, '100,00;"S"')
      .replace(";70002;4985;9;", `;70002;${darlehen};;`)
      .replace(";15,97;", ";;");
    const [v] = archiv(lese(kontenrahmen, [zeile]));
    expect(v).toMatchObject({
      externalId: "sevdesk-export/1111111111111111112|2024-01-15|70002|",
      type: "salesinvoice",
      direction: "einnahme",
      accountKind: "sonstige",
      account: darlehen,
      gross: 10000,
      net: 10000,
      tax: 0,
      rate: 0,
    });
  });

  it("Tilgung (Sachkonto im Soll): Ausgabe mit positivem Betrag", () => {
    const zeile = ohneBeleglink(ausgabe!).replace(";70002;4985;9;", `;70002;${darlehen};;`).replace(";15,97;", ";;");
    const [v] = archiv(lese(kontenrahmen, [zeile]));
    expect(v).toMatchObject({ type: "purchaseinvoice", direction: "ausgabe", accountKind: "sonstige", gross: 10000, tax: 0 });
  });
});

describe("Gutschrift im Gutschriftverfahren (Honorar, Provision)", () => {
  it("wird eine Ausgabe-Gutschrift mit positivem Betrag und Vorsteuer, obwohl sie im Rechnungsausgang liegt", () => {
    const result = readSevdeskExport(
      zip({
        "EXTF_Buchungsstapel_20261001_20261130.csv": fixture("buchhaltung-2.0/extf-buchungsstapel-gutschriften.csv"),
        "DATEV_Rechnungsausgang_20261001_20261130.zip": innerZip(fixture("buchhaltung-2.0/document-rechnungsausgang-gutschriften.xml")),
      }),
      { kontenrahmen: "SKR03" },
    );
    if (!result.ok) throw new Error(result.reason);
    for (const v of archiv(result.export)) {
      expect(v).toMatchObject({ type: "purchasecreditnote", direction: "ausgabe", accountKind: "aufwand", gross: 119, net: 100, tax: 19, rate: 1900 });
    }
  });
});

describe.each(["SKR03", "SKR04"] as const)("Beleg mit Zeilen auf beiden Seiten (%s)", (kontenrahmen) => {
  // Eine Rechnung (100,00 im Haben) und unter derselben GUID eine Minderung im Soll (10,00, etwa Rabatt oder verrechnete
  // Anzahlung): Die Steuer der Minderung mindert die Steuer des Belegs, sie kommt nicht dazu.
  const minderung = (zeile: string) =>
    zeile
      .replace(/^100,00;"H"/, '10,00;"S"')
      .replace(";84,03;", ";8,40;")
      .replace(";15,97;", ";1,60;");

  it("Steuer aus Beleginfo mit dem Vorzeichen der Zeile", () => {
    const [v] = archiv(lese(kontenrahmen, [rechnung!, minderung(rechnung!)]));
    expect(v).toMatchObject({ type: "salesinvoice", direction: "einnahme", gross: 9000, tax: 1437, net: 7563 });
  });

  it("Steuer aus dem Automatikkonto mit dem Vorzeichen der Zeile", () => {
    const ohneInfo = (zeile: string) => zeile.replace(/;"Nettobetrag";[^;]*;"Steuerbetrag";[^;]*;/, ';"Nettobetrag";;"Steuerbetrag";;');
    const [v] = archiv(lese(kontenrahmen, [ohneInfo(rechnung!), ohneInfo(minderung(rechnung!))]));
    // 100,00 brutto: 15,97 Steuer; 10,00 brutto: 1,60 Steuer
    expect(v).toMatchObject({ gross: 9000, tax: 1437, net: 7563 });
  });
});

describe.each(["SKR03", "SKR04"] as const)("Steuersatz aus Beleginfo (%s)", (kontenrahmen) => {
  it("geht vor BU-Schlüssel und Automatikkonto, wenn der Steuerbetrag fehlt (historisch 16 %)", () => {
    const zeile = gutschrift!.replace('"Umsatzsteuerprozent";19;', '"Umsatzsteuerprozent";16;');
    const [v] = archiv(lese(kontenrahmen, [zeile]));
    // 100,00 brutto bei 16 %: 13,79 Steuer, nicht 15,97 aus dem Automatikkonto (19 %)
    expect(v).toMatchObject({ type: "salescreditnote", gross: -10000, tax: -1379, net: -8621, rate: 1600 });
  });
});
