import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildVastAbholungXml, buildVastAnfrageXml, parseVastBeleg, parseVastBelegListe, parseVastDatenpakete, vastBelegartLabel } from "./vast.ts";
import { datenartVersionFromXml, hasTestmerker } from "./xml.ts";

const input = { idnr: "02293417683", veranlagungsjahr: 2025, datenlieferant: "Erika Muster", herstellerId: "74931", test: true };

describe("Belegabruf-XML", () => {
  it("fragt die Liste mit Testmerker 370000001 und Empfänger CS an", () => {
    const xml = buildVastAnfrageXml(input);
    expect(xml).toContain("<Verfahren>ElsterDatenabholung</Verfahren>");
    expect(xml).toContain("<DatenArt>ElsterVaStDaten</DatenArt>");
    expect(xml).toContain("<Testmerker>370000001</Testmerker>");
    expect(xml).toContain('<Empfaenger id="L">CS</Empfaenger>');
    expect(xml).toContain('<Datenabholung version="10">\n<Anfrage idnr="02293417683" veranlagungsjahr="2025"/>');
    expect(datenartVersionFromXml(xml)).toBe("ElsterVaStDaten");
    expect(hasTestmerker(xml)).toBe(true);
  });

  it("holt jeden Beleg in einem eigenen Nutzdatenblock mit der ID als Ticket", () => {
    const xml = buildVastAbholungXml(["a-1", "a-2"], { ...input, idnr: "65929970489", test: false });
    expect(xml).not.toContain("Testmerker");
    expect(xml.match(/<Nutzdatenblock>/g)).toHaveLength(2);
    expect(xml).toContain("<NutzdatenTicket>a-2</NutzdatenTicket>");
    expect(xml).toContain('<Abholung id="a-1" idnr="65929970489" veranlagungsjahr="2025"/>');
    expect(() => buildVastAbholungXml([], input)).toThrow();
  });

  it("prüft die IdNr: echt mit Prüfziffer, im Test auch ELSTER-Test-IdNrs", () => {
    expect(() => buildVastAnfrageXml({ ...input, test: false })).toThrow(/IdNr/);
    expect(() => buildVastAnfrageXml({ ...input, idnr: "123" })).toThrow(/IdNr/);
    expect(() => buildVastAnfrageXml({ ...input, idnr: "65929970489", test: false })).not.toThrow();
  });
});

const sample = (name: string) => {
  try {
    return readFileSync(`/var/tmp/erica/tests/worker/samples/${name}`, "utf8");
  } catch {
    return undefined;
  }
};

describe("Belegabruf-Antworten", () => {
  it("liest die Beleg-IDs samt Belegart", () => {
    const xml = `<Elster><DatenTeil><Nutzdatenblock><Nutzdaten><Datenabholung version="10">
      <Anfrage einschraenkung="alle" veranlagungsjahr="2025" idnr="02293417683">
        <Id groesse="1600" belegart="VaSt_RBM" hashwert="abc" schemaversion="202001">vb30
        </Id>
        <Id groesse="1000" belegart="VaSt_Pers2" hashwert="def" schemaversion="1">vz30</Id>
      </Anfrage></Datenabholung></Nutzdaten></Nutzdatenblock></DatenTeil></Elster>`;
    expect(parseVastBelegListe(xml)).toEqual([
      { id: "vb30", belegart: "VaSt_RBM", groesse: 1600, hashwert: "abc", schemaversion: "202001" },
      { id: "vz30", belegart: "VaSt_Pers2", groesse: 1000, hashwert: "def", schemaversion: "1" },
    ]);
    expect(parseVastBelegListe("")).toEqual([]);
  });

  it("liest die Datenpakete ohne Zeilenumbrüche", () => {
    const xml = `<Elster><Datenabholung version="10"><Abholung id="x" idnr="1"><Datenpaket>
      QUJD\\r\\nREVG
    </Datenpaket></Abholung></Datenabholung></Elster>`;
    expect(parseVastDatenpakete(xml)).toEqual([{ id: "x", datenpaket: "QUJDREVG" }]);
  });

  it.skipIf(!sample("sample_beleg_id_response.xml"))("versteht die Beispielantworten aus erica", () => {
    const liste = parseVastBelegListe(sample("sample_beleg_id_response.xml")!);
    expect(liste.length).toBeGreaterThan(2);
    expect(liste[0]).toMatchObject({ belegart: "VaSt_RBM", id: "vb3077iudj6nrd6h5istk3c3mzbbi88r" });
    const pakete = parseVastDatenpakete(sample("sample_encrypted_beleg_response.xml")!);
    expect(pakete).toHaveLength(1);
    expect(pakete[0]!.datenpaket).toMatch(/^[A-Za-z0-9+/=]+$/);
    const [rbm] = parseVastBeleg(sample("sample_decrypted_beleg_response.xml")!);
    expect(rbm!.belegart).toBe("VaSt_RBM");
    expect(rbm!.werte).toContainEqual({ pfad: ["Mitteilung", "Leistung", "Teilleistung", "Betrag"], wert: "22000.20" });
  });

  it("liest Belege generisch, auch mehrere unter <Belege>", () => {
    const belege = parseVastBeleg(
      `<?xml version="1.0" encoding="ISO-8859-15"?><Belege xmlns:ns0="x"><VaSt_Pers1 version="4"><Inhaber><NatPers>` +
        `<Vorname>ERIKA</Vorname><Name>MUSTER</Name></NatPers></Inhaber></VaSt_Pers1><VaSt_Pers2><Religion>VD</Religion></VaSt_Pers2></Belege>`,
    );
    expect(belege).toEqual([
      {
        belegart: "VaSt_Pers1",
        werte: [
          { pfad: ["Inhaber", "NatPers", "Vorname"], wert: "ERIKA" },
          { pfad: ["Inhaber", "NatPers", "Name"], wert: "MUSTER" },
        ],
      },
      { belegart: "VaSt_Pers2", werte: [{ pfad: ["Religion"], wert: "VD" }] },
    ]);
  });

  it("benennt Belegarten", () => {
    expect(vastBelegartLabel("VaSt_RBM")).toBe("Rentenbezugsmitteilung");
    expect(vastBelegartLabel("VaSt_XYZ")).toBe("XYZ");
  });
});
