import { describe, expect, it } from "vitest";
import { parseCamt053 } from "./camt.ts";

const camt = (details: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Id>1</Id>
      <Acct><Id><IBAN>DE12120300001234567890</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Ntry>
        <Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
        <BookgDt><Dt>2026-09-02</Dt></BookgDt>
        <NtryDtls>${details}</NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

describe("parseCamt053 (Review)", () => {
  it("dekodiert numerische Zeichenreferenzen in Namen und Verwendungszweck", () => {
    const s = parseCamt053(
      camt(`<TxDtls><RltdPties><Dbtr><Nm>M&#252;ller &#x26; S&#246;hne</Nm></Dbtr></RltdPties><RmtInf><Ustrd>Gr&#252;&#223;e</Ustrd></RmtInf></TxDtls>`),
    );
    expect(s.transactions[0]!.counterpartyName).toBe("Müller & Söhne");
    expect(s.transactions[0]!.purpose).toBe("Grüße");
  });
});
