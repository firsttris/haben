import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSpezRechtAntragXml,
  buildSpezRechtFreischaltungXml,
  buildSpezRechtListeXml,
  buildSpezRechtStornoXml,
  normalizeFreischaltcode,
  parseBrmRueckgabe,
  parseSpezRechtAntragAntwort,
  parseSpezRechtListe,
  parseSpezRechtStatus,
} from "./berechtigung.ts";
import { FakeElsterClient } from "./fake-client.ts";
import { datenartVersionFromXml, hasTestmerker } from "./xml.ts";

const base = { datenlieferant: "Max Muster", herstellerId: "74931", test: true };
const antrag = { ...base, dateninhaberIdnr: "02293417683", dateninhaberGeburtsdatum: "1987-03-01", gueltigBis: "2028-12-31" };

describe("Berechtigungsmanagement-XML", () => {
  it("beantragt das Recht AbrufEBelege für alle Jahre", () => {
    const xml = buildSpezRechtAntragXml({ ...antrag, mail: "max@example.com" });
    expect(xml).toContain("<Verfahren>ElsterBRM</Verfahren>");
    expect(xml).toContain("<DatenArt>SpezRechtAntrag</DatenArt>");
    expect(xml).toContain("<Testmerker>370000001</Testmerker>");
    expect(xml).toContain('<Empfaenger id="L">CS</Empfaenger>');
    expect(xml).toContain(
      "<DateninhaberIdNr>02293417683</DateninhaberIdNr>\n<DateninhaberGeburtstag>1987-03-01</DateninhaberGeburtstag>\n<Recht>AbrufEBelege</Recht>\n<GueltigBis>2028-12-31</GueltigBis>\n<DatenabruferMail>max@example.com</DatenabruferMail>",
    );
    expect(xml).toContain("<Unbeschraenkt>true</Unbeschraenkt>");
    expect(datenartVersionFromXml(xml)).toBe("SpezRechtAntrag");
    expect(hasTestmerker(xml)).toBe(true);
  });

  it("beschränkt auf einzelne Jahre und prüft die Eingaben", () => {
    const xml = buildSpezRechtAntragXml({ ...antrag, jahre: [2025, 2024, 2025] });
    expect(xml).toContain("<Unbeschraenkt>false</Unbeschraenkt>\n<Veranlagungsjahre>\n<Jahr>2024</Jahr>\n<Jahr>2025</Jahr>");
    expect(xml).not.toContain("DatenabruferMail");
    expect(() => buildSpezRechtAntragXml({ ...antrag, test: false })).toThrow(/IdNr/);
    expect(() => buildSpezRechtAntragXml({ ...antrag, gueltigBis: "31.12.2028" })).toThrow(/Gültig/);
    expect(() => buildSpezRechtAntragXml({ ...antrag, jahre: [2025, 25] })).toThrow(/Ungültiges Jahr: 25/);
    expect(() => buildSpezRechtAntragXml({ ...antrag, jahre: [2024.5] })).toThrow(/Ungültiges Jahr/);
  });

  it("schaltet frei, widerruft und listet", () => {
    const frei = buildSpezRechtFreischaltungXml("br1272xf3i59m2323ft9qtk7iqzxzke4", "ygub mxsg c1q2", { ...base, test: false });
    expect(frei).toContain("<AntragsID>br1272xf3i59m2323ft9qtk7iqzxzke4</AntragsID>\n<Freischaltcode>YGUB-MXSG-C1Q2</Freischaltcode>");
    expect(frei).not.toContain("Testmerker");
    expect(datenartVersionFromXml(frei)).toBe("SpezRechtFreischaltung");
    expect(() => buildSpezRechtStornoXml("x<y", base)).toThrow();
    expect(datenartVersionFromXml(buildSpezRechtStornoXml("br1271mrfht6w750", base))).toBe("SpezRechtStorno");
    expect(buildSpezRechtListeXml(base)).toContain('<SpezRechtListe version="7"/>');
    expect(() => normalizeFreischaltcode("ABC")).toThrow(/12 Zeichen/);
  });
});

const sample = (name: string) => {
  try {
    return readFileSync(`/var/tmp/erica/tests/worker/samples/${name}`, "utf8");
  } catch {
    return undefined;
  }
};

describe("Berechtigungsmanagement-Antworten", () => {
  it("liest Antrag, Status und Liste", () => {
    const antwort = `<Elster><DatenTeil><Nutzdatenblock><NutzdatenHeader><RC><Rueckgabe><Code>0</Code><Text>OK</Text></Rueckgabe></RC></NutzdatenHeader>
      <Nutzdaten><SpezRechtAntrag version="3"><AntragAntwort><AntragsID>br127</AntragsID><AntragsDatum>2026-10-03T12:00:00</AntragsDatum>
      <GenehmigenBis>2027-01-01</GenehmigenBis><AntragsStatus>offen</AntragsStatus></AntragAntwort></SpezRechtAntrag></Nutzdaten></Nutzdatenblock></DatenTeil></Elster>`;
    expect(parseSpezRechtAntragAntwort(antwort)).toEqual({ antragsId: "br127", antragsDatum: "2026-10-03T12:00:00", genehmigenBis: "2027-01-01", status: "offen" });
    expect(parseBrmRueckgabe(antwort)).toEqual({ code: 0, text: "OK" });
    expect(parseSpezRechtAntragAntwort("")).toBeUndefined();
    expect(parseSpezRechtStatus("<X><StornoAntwort><AntragsStatus>widerrufen</AntragsStatus></StornoAntwort></X>")).toBe("widerrufen");
  });

  it.skipIf(!sample("sample_vast_list.xml"))("versteht die Beispielantworten aus erica", () => {
    expect(parseSpezRechtAntragAntwort(sample("sample_vast_request_response.xml")!)).toMatchObject({ antragsId: "br12701v299sh650fgwcn0c31z2k0xrb", status: "offen" });
    expect(parseSpezRechtStatus(sample("sample_vast_activation_response.xml")!)).toBe("genehmigt");
    expect(parseSpezRechtStatus(sample("sample_vast_revocation_response.xml")!)).toBe("widerrufen");
    expect(parseBrmRueckgabe(sample("sample_vast_revocation_response_failure.xml")!)).toMatchObject({ code: 371015211, text: expect.stringMatching(/^Es ist kein Antrag/) });
    expect(parseSpezRechtListe(sample("sample_vast_list.xml")!)).toEqual([
      expect.objectContaining({ antragsId: "br1652dntwz6wg1md87hc6055aij0nev", status: "genehmigt", dateninhaberIdnr: "02293417683", jahre: [], gueltigBis: "2224-12-31" }),
      expect.objectContaining({ antragsId: "br1226cnpymxm35hf0ptmsmc2nqpv9y9", jahre: [2021] }),
    ]);
  });

  it("simuliert den Ablauf ohne ERiC", async () => {
    const client = new FakeElsterClient();
    const send = (xml: string) => client.send(xml, new Uint8Array([1]), "1234", { test: true, print: false });
    const beantragt = parseSpezRechtAntragAntwort((await send(buildSpezRechtAntragXml(antrag))).serverResponseXml)!;
    expect(beantragt.status).toBe("offen");
    const frei = await send(buildSpezRechtFreischaltungXml(beantragt.antragsId, "TEST-TEST-TEST", base));
    expect(parseSpezRechtStatus(frei.serverResponseXml)).toBe("genehmigt");
    expect(parseSpezRechtStatus((await send(buildSpezRechtStornoXml(beantragt.antragsId, base))).serverResponseXml)).toBe("widerrufen");
  });
});
