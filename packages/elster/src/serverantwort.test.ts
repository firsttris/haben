import { describe, expect, it } from "vitest";
import { mitServerMeldung, serverRueckmeldungen } from "./serverantwort.ts";

/**
 * Aufbau wie in den Antworten des ELSTER-Servers, die erica (digitalservicebund, MIT) als Beispiele mitliefert:
 * TransferHeader und NutzdatenHeader tragen je ein RC mit Rueckgabe und Stack. Die Texte hier sind erfunden.
 */
const antwort = (transfer: string, nutzdaten = "") => `<?xml version="1.0" encoding="UTF-8"?>
<Elster xmlns="http://www.elster.de/elsterxml/schema/v11">
  <TransferHeader version="11">
    <Verfahren>ElsterAnmeldung</Verfahren>
    <TransferTicket>et0000000000000000000000000000000</TransferTicket>
    <RC>${transfer}</RC>
  </TransferHeader>
  <DatenTeil>
    <Nutzdatenblock>
      <NutzdatenHeader version="11">
        <NutzdatenTicket>1</NutzdatenTicket>
        ${nutzdaten ? `<RC>${nutzdaten}</RC>` : ""}
      </NutzdatenHeader>
      <Nutzdaten/>
    </Nutzdatenblock>
  </DatenTeil>
</Elster>`;

const ok = "<Rueckgabe><Code>0</Code><Text>OK</Text></Rueckgabe><Stack><Code></Code><Text></Text></Stack>";
const fehler = (code: number, text: string, stack = "<Code></Code><Text></Text>") =>
  `<Rueckgabe><Code>${code}</Code><Text>${text}</Text></Rueckgabe><Stack>${stack}</Stack>`;

describe("serverRueckmeldungen", () => {
  it("liest den Fehler im Transferheader", () => {
    const xml = antwort(fehler(610101210, "Beispieltext zum Transferheader."));
    expect(serverRueckmeldungen(xml)).toEqual([{ quelle: "Transferheader", code: 610101210, text: "Beispieltext zum Transferheader." }]);
  });

  it("liest den Fehler im Nutzdatenheader", () => {
    const xml = antwort(ok, fehler(371015211, "Es ist kein Antrag\n   vorhanden. ", "<Code>371015211</Code><Text></Text>"));
    expect(serverRueckmeldungen(xml)).toEqual([{ quelle: "Nutzdatenheader", code: 371015211, text: "Es ist kein Antrag vorhanden." }]);
  });

  it("nennt beide, wenn beide Header einen Fehler melden, und alle Nutzdatenblöcke", () => {
    const xml = `<Elster><TransferHeader><RC>${fehler(1, "A")}</RC></TransferHeader>
      <DatenTeil><Nutzdatenblock><NutzdatenHeader><RC>${fehler(2, "B")}</RC></NutzdatenHeader></Nutzdatenblock>
      <Nutzdatenblock><NutzdatenHeader><RC>${fehler(3, "C")}</RC></NutzdatenHeader></Nutzdatenblock></DatenTeil></Elster>`;
    expect(serverRueckmeldungen(xml).map((m) => [m.quelle, m.code])).toEqual([
      ["Transferheader", 1],
      ["Nutzdatenheader", 2],
      ["Nutzdatenheader", 3],
    ]);
  });

  it("nimmt einen abweichenden Code im Stack dazu", () => {
    const xml = antwort(fehler(610101210, "Haupttext", "<Code>610101999</Code><Text>Detail</Text>"));
    expect(serverRueckmeldungen(xml)).toEqual([
      { quelle: "Transferheader", code: 610101210, text: "Haupttext" },
      { quelle: "Transferheader", code: 610101999, text: "Detail" },
    ]);
  });

  it("nimmt den Text des Stacks dazu, wenn er bei gleichem Code etwas anderes sagt", () => {
    const xml = antwort(fehler(5, "Haupttext", "<Code>5</Code><Text>Genauer</Text>"));
    expect(serverRueckmeldungen(xml).map((m) => m.text)).toEqual(["Haupttext", "Genauer"]);
  });

  it("meldet denselben Code nicht doppelt, wenn nur der Stack den Text liefert", () => {
    const xml = antwort("<Rueckgabe><Code>5</Code><Text></Text></Rueckgabe><Stack><Code>5</Code><Text>Genauer</Text></Stack>");
    expect(serverRueckmeldungen(xml)).toEqual([{ quelle: "Transferheader", code: 5, text: "Genauer" }]);
  });

  it("meldet nichts bei Erfolg, ohne Antwort und bei etwas, das kein XML ist", () => {
    expect(serverRueckmeldungen(antwort(ok, ok))).toEqual([]);
    expect(serverRueckmeldungen("")).toEqual([]);
    expect(serverRueckmeldungen("   ")).toEqual([]);
    expect(serverRueckmeldungen("kein xml")).toEqual([]);
    expect(serverRueckmeldungen("<Elster/>")).toEqual([]);
  });

  it("versteht Namensraum-Präfixe", () => {
    const xml = `<e:Elster xmlns:e="http://www.elster.de/elsterxml/schema/v11"><e:TransferHeader><e:RC><e:Rueckgabe><e:Code>5</e:Code><e:Text>X</e:Text></e:Rueckgabe></e:RC></e:TransferHeader></e:Elster>`;
    expect(serverRueckmeldungen(xml)).toEqual([{ quelle: "Transferheader", code: 5, text: "X" }]);
  });
});

describe("mitServerMeldung", () => {
  const eric = "Fehler im Transferheader. Der ELSTER-Annahmeserver hat einen Fehler zurückgemeldet. Bitte werten Sie die Serverantwort aus.";

  it("hängt Code und Text des Servers an die Meldung von ERiC", () => {
    const xml = antwort(fehler(610101210, "Beispieltext zum Transferheader."));
    expect(mitServerMeldung(eric, xml)).toBe(`${eric} Antwort des ELSTER-Servers: Transferheader 610101210 – Beispieltext zum Transferheader.`);
  });

  it("trennt mehrere Rückmeldungen", () => {
    const xml = `<Elster><TransferHeader><RC>${fehler(1, "A")}</RC></TransferHeader><DatenTeil><Nutzdatenblock><NutzdatenHeader><RC>${fehler(2, "B")}</RC></NutzdatenHeader></Nutzdatenblock></DatenTeil></Elster>`;
    expect(mitServerMeldung("M", xml)).toBe("M Antwort des ELSTER-Servers: Transferheader 1 – A; Nutzdatenheader 2 – B");
  });

  it("lässt die Meldung wie sie ist, wenn der Server nichts meldet", () => {
    expect(mitServerMeldung(eric, "")).toBe(eric);
    expect(mitServerMeldung(eric, antwort(ok))).toBe(eric);
  });

  it("nennt auch einen Code ohne Text", () => {
    expect(mitServerMeldung("M", antwort(fehler(7, "")))).toBe("M Antwort des ELSTER-Servers: Transferheader 7");
  });
});
