import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gegenparteiAusFreitext } from "./camt-freitext.ts";
import { parseCamt053 } from "./camt.ts";
import { parseStatement } from "./index.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url)));

const camt = (details: string, additional = "") => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <Stmt>
      <Id>1</Id>
      <Acct><Id><IBAN>DE55010020030000000001</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Ntry>
        <Amt Ccy="EUR">120.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2026-03-02</Dt></BookgDt>
        <NtryDtls>${details}</NtryDtls>
        <AddtlNtryInf>${additional}</AddtlNtryInf>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

const VON = "Eingehende Überweisung Von Muster Handel GmbH Rechnung 2026-0007 DE71010020030000000101 TESTDEFFXXX";

describe("CAMT.053 von Vivid Business (Gegenpartei nur im Freitext)", () => {
  // Anonymisierte Kopie eines Original-Exports aus #1515: 31 eingehende, 10 ausgehende Überweisungen, 4 Kartenzahlungen
  it("liest Name und IBAN bei ein- und ausgehender Überweisung, den Händler bei der Kartenzahlung", () => {
    const s = parseStatement(fixture("camt053-vivid.xml"));
    expect(s.format).toBe("camt053");
    expect(s.transactions).toHaveLength(45);
    expect(s.openingBalance! + s.transactions.reduce((a, t) => a + t.amount, 0)).toBe(s.closingBalance);
    expect(s.transactions.filter((t) => t.counterpartyName === "")).toEqual([]);
    expect(s.transactions.filter((t) => t.counterpartyIban !== undefined)).toHaveLength(41);
    const zeile = (i: number) => {
      const t = s.transactions[i]!;
      return [t.amount, t.counterpartyName, t.counterpartyIban, t.purpose];
    };
    expect([0, 5, 35, 28].map(zeile)).toEqual([
      [2373, "Beispiel Software AG", "DE71010020030000000101", "Rechnung 2026-0001"],
      [-9238, "Demo Store Inc", "DE33010020030000000106", "Auszahlung Periode 07"],
      [2428, "Max Mustermann", "IE77TEST90000100000136", "Auszahlung Periode 01"],
      [-16817, "Beispiel Shop Online ABCDE", undefined, "Kartentransaktion Beispiel Shop Online ABCDE Ab9C3d, Musterstadt, DE"],
    ]);
  });

  it("liest RltdPties wie bisher, auch wenn der Freitext gefüllt ist", () => {
    const s = parseCamt053(
      camt(
        `<TxDtls><RltdPties><Dbtr><Pty><Nm>Echte Partei AG</Nm></Pty></Dbtr><DbtrAcct><Id><IBAN>DE89370400440532013000</IBAN></Id></DbtrAcct></RltdPties><RmtInf><Ustrd>Rechnung 2026-0007</Ustrd></RmtInf><AddtlTxInf>${VON}</AddtlTxInf></TxDtls>`,
        VON,
      ),
    );
    expect(s.transactions[0]).toMatchObject({ counterpartyName: "Echte Partei AG", counterpartyIban: "DE89370400440532013000" });
  });

  it("nimmt AddtlNtryInf, wenn AddtlTxInf fehlt", () => {
    const s = parseCamt053(camt("<TxDtls><RmtInf><Ustrd>Rechnung 2026-0007</Ustrd></RmtInf></TxDtls>", VON));
    expect(s.transactions[0]).toMatchObject({ counterpartyName: "Muster Handel GmbH", counterpartyIban: "DE71010020030000000101" });
  });

  it("übernimmt den Freitext des Eintrags nicht in die Posten einer Sammelbuchung", () => {
    const posten = '<TxDtls><Amt Ccy="EUR">60.00</Amt><RmtInf><Ustrd>Rechnung 2026-0007</Ustrd></RmtInf></TxDtls>';
    const s = parseCamt053(camt(posten + posten, VON));
    expect(s.transactions.map((t) => [t.counterpartyName, t.counterpartyIban])).toEqual([
      ["", undefined],
      ["", undefined],
    ]);
  });
});

describe("gegenparteiAusFreitext", () => {
  it.each([
    ["unbekanntes Präfix", "Gutschrift Von Muster Handel GmbH Rechnung 2026-0007 DE71010020030000000101 TESTDEFFXXX", "Rechnung 2026-0007", true],
    [
      "Prüfziffer der IBAN falsch",
      "Eingehende Überweisung Von Muster Handel GmbH Rechnung 2026-0007 DE71010020030000000102 TESTDEFFXXX",
      "Rechnung 2026-0007",
      true,
    ],
    ["keine IBAN am Ende", "Eingehende Überweisung Von Muster Handel GmbH Rechnung 2026-0007", "Rechnung 2026-0007", true],
    ["BIC fehlt", "Eingehende Überweisung Von Muster Handel GmbH Rechnung 2026-0007 DE71010020030000000101", "Rechnung 2026-0007", true],
    ["Verwendungszweck weicht ab", VON, "Rechnung 2026-0008", true],
    ["kein Verwendungszweck", VON, "", true],
    ["kein Name vor dem Zweck", "Eingehende Überweisung Von Rechnung 2026-0007 DE71010020030000000101 TESTDEFFXXX", "Rechnung 2026-0007", true],
    ["Richtung passt nicht zum Betrag", VON, "Rechnung 2026-0007", false],
    ["Karte ohne Kürzel", "Kartentransaktion Beispiel Shop Online, Musterstadt, DE", "", false],
    ["Karte ohne Ort", "Kartentransaktion Beispiel Shop Online Ab9C3d", "", false],
  ])("lässt die Gegenpartei leer: %s", (_fall, freitext, purpose, credit) => {
    expect(gegenparteiAusFreitext(freitext, purpose, credit)).toBeUndefined();
  });

  it("fasst Leerraum zusammen und gibt die IBAN in Großbuchstaben", () => {
    expect(
      gegenparteiAusFreitext(
        "Eingehende Überweisung Von  Muster   Handel GmbH Rechnung 2026-0007 de71010020030000000101 TESTDEFFXXX",
        "Rechnung 2026-0007",
        true,
      ),
    ).toEqual({
      name: "Muster Handel GmbH",
      iban: "DE71010020030000000101",
    });
  });
});
