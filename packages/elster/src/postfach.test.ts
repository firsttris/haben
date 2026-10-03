import { describe, expect, it } from "vitest";
import { checkXml } from "./fake-client.ts";
import { buildPostfachAnfrageXml, buildPostfachBestaetigungXml, parsePostfachAntwort, postfachDateiname } from "./postfach.ts";
import { datenartVersionFromXml, hasTestmerker } from "./xml.ts";

const base = { datenlieferant: "Max Muster", herstellerId: "74931", produktVersion: "0.1.0", test: true };

describe("Postfach-XML", () => {
  it("baut die PostfachAnfrage Version 31", () => {
    const xml = buildPostfachAnfrageXml(base);
    expect(checkXml(xml)).toBeUndefined();
    expect(datenartVersionFromXml(xml)).toBe("PostfachAnfrage_31");
    expect(hasTestmerker(xml)).toBe(true);
    expect(xml).toContain("<Verfahren>ElsterDatenabholung</Verfahren>");
    expect(xml).toContain(`<Empfaenger id="L">CS</Empfaenger>`);
    expect(xml).toContain(`<PostfachAnfrage einschraenkung="alle" max="1000">`);
    expect(xml).toContain(`<DatenartBereitstellung name="DivaBescheidESt"/>`);
    expect(xml).not.toContain("<Ziel>");
  });

  it("baut die PostfachBestaetigung", () => {
    const xml = buildPostfachBestaetigungXml(["a1", "b&2"], { ...base, test: false });
    expect(checkXml(xml)).toBeUndefined();
    expect(datenartVersionFromXml(xml)).toBe("PostfachBestaetigung_31");
    expect(hasTestmerker(xml)).toBe(false);
    expect(xml).toContain(`<Bereitstellung id="a1"/>`);
    expect(xml).toContain(`<Bereitstellung id="b&amp;2"/>`);
    expect(() => buildPostfachBestaetigungXml([], base)).toThrow();
  });
});

describe("parsePostfachAntwort", () => {
  const antwort = `<?xml version="1.0" encoding="UTF-8"?>
<Elster xmlns="http://www.elster.de/elsterxml/schema/v11"><DatenTeil><Nutzdatenblock><Nutzdaten>
<da:Datenabholung xmlns:da="http://finkonsens.de/elster/elsterdatenabholung/v3" version="31"><da:PostfachAnfrage>
  <da:DatenartBereitstellung name="ESB" anzahltreffer="0"/>
  <da:DatenartBereitstellung name="DivaBescheidESt" anzahltreffer="2">
    <da:Bereitstellung id="X1" groesse="1234">
      <da:Meta name="veranlagungszeitraum">2024</da:Meta>
      <da:Meta name="steuernummer">2836216146249</da:Meta>
      <da:Meta name="bescheiddatum">2025-06-30</da:Meta>
      <da:Anhang><da:Dateibezeichnung>Bescheid ESt</da:Dateibezeichnung><da:Dateityp>application/pdf</da:Dateityp><da:DateiReferenzId>R1</da:DateiReferenzId><da:DateiGroesse>1000</da:DateiGroesse></da:Anhang>
      <da:Anhang><da:Dateibezeichnung>Erläuterungen</da:Dateibezeichnung><da:Dateityp>text/xml</da:Dateityp><da:DateiReferenzId>R2</da:DateiReferenzId><da:DateiGroesse>234</da:DateiGroesse></da:Anhang>
    </da:Bereitstellung>
    <da:Bereitstellung id="X2" groesse="10">
      <da:Anhang><da:Dateibezeichnung>Ohne Referenz</da:Dateibezeichnung></da:Anhang>
    </da:Bereitstellung>
  </da:DatenartBereitstellung>
</da:PostfachAnfrage></da:Datenabholung></Nutzdaten></Nutzdatenblock></DatenTeil></Elster>`;

  it("liest Bereitstellungen, Metadaten und Anhänge", () => {
    expect(parsePostfachAntwort(antwort)).toEqual([
      {
        id: "X1",
        datenart: "DivaBescheidESt",
        groesse: 1234,
        veranlagungszeitraum: "2024",
        steuernummer: "2836216146249",
        bescheiddatum: "2025-06-30",
        anhaenge: [
          { dateibezeichnung: "Bescheid ESt", dateityp: "application/pdf", referenzId: "R1", groesse: 1000 },
          { dateibezeichnung: "Erläuterungen", dateityp: "text/xml", referenzId: "R2", groesse: 234 },
        ],
      },
      { id: "X2", datenart: "DivaBescheidESt", groesse: 10, veranlagungszeitraum: "", steuernummer: "", bescheiddatum: "", anhaenge: [] },
    ]);
  });

  it("kommt mit leerer Antwort zurecht", () => {
    expect(parsePostfachAntwort("")).toEqual([]);
    expect(parsePostfachAntwort("<Elster/>")).toEqual([]);
  });

  it("baut Dateinamen wie viking", () => {
    expect(postfachDateiname({ veranlagungszeitraum: "2024" }, { dateibezeichnung: "Bescheid ESt", dateityp: "application/pdf" })).toBe(
      "Bescheid_ESt_2024.pdf",
    );
    expect(postfachDateiname({ veranlagungszeitraum: "" }, { dateibezeichnung: "", dateityp: "x/y" })).toBe("Dokument.bin");
  });
});
