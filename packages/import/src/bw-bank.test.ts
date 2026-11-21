import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectStatementFormat, parseStatement } from "./parse.ts";

const lies = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "..", "test-fixtures", name)));
const ersetzt = (name: string, von: string, nach: string) => new TextEncoder().encode(new TextDecoder("windows-1252").decode(lies(name)).replace(von, nach));

describe("BW-Bank-CSV (CSV-CAMT V8)", () => {
  const auszug = parseStatement(lies("bw-bank-camt.csv"), "20261115-umsatz.csv");
  const t = auszug.transactions;

  it("erkennt das Format am Kopf und nimmt die eigene IBAN aus „Auftragskonto“", () => {
    expect(detectStatementFormat(lies("bw-bank-camt.csv"))).toBe("bw-bank-csv");
    expect(auszug.format).toBe("bw-bank-csv");
    expect(auszug.accountIban).toBe("DE02120300000000202051");
    expect(auszug.openingBalance).toBeUndefined();
  });

  it("überspringt vorgemerkte Umsätze und meldet sie", () => {
    expect(t).toHaveLength(3);
    expect(auszug.warnings).toEqual(["1 vorgemerkter Umsatz wurde übersprungen."]);
  });

  it("liest Beträge mit Tausenderpunkt, Datum als TT.MM.JJ und Umlaute aus Windows-1252", () => {
    expect(t.map((x) => x.amount)).toEqual([-1856, 119_000, -990]);
    expect(t.map((x) => x.bookingDate)).toEqual(["2026-11-13", "2026-11-12", "2026-11-10"]);
    expect(t[1]?.counterpartyName).toBe("Müller & Söhne KG");
    expect(t[1]?.purpose).toBe("Rechnung 2026-034 Müller & Söhne");
  });

  it("nimmt Gegen-IBAN und Referenzen aus eigenen Spalten, Platzhalter nicht", () => {
    expect(t[0]).toMatchObject({
      counterpartyIban: "DE89370400440532013000",
      type: "FOLGELASTSCHRIFT",
      creditorId: "DE98ZZZ09999999999",
      mandateReference: "MANDAT-1",
      endToEndId: "E2E-77",
      bankReference: "7001",
    });
    expect(t[1]?.endToEndId).toBeUndefined();
    expect(t[2]?.counterpartyIban).toBeUndefined();
  });

  it("lehnt eine Datei mit Umsätzen mehrerer Konten ab", () => {
    const zwei = ersetzt("bw-bank-camt.csv", '"DE02120300000000202051";"12.11.26"', '"DE75512108001245126199";"12.11.26"');
    expect(() => parseStatement(zwei)).toThrow(/mehrerer Konten/);
  });
});

describe("andere Exporte der BW-Bank", () => {
  // CSV-CAMT V2 und „gefilterte Einträge“ hängen „Kategorie“ an
  const v2 = () => {
    const text = new TextDecoder("windows-1252").decode(lies("bw-bank-camt.csv"));
    const lines = text.split(/\r?\n/).map((l, i) => (l ? `${l};${i === 0 ? '"Kategorie"' : '""'}` : l));
    return new TextEncoder().encode(lines.join("\n"));
  };

  it("erkennt CSV-MT940 und verlangt CSV-CAMT V8", () => {
    expect(detectStatementFormat(lies("bw-bank-mt940.csv"))).toBe("bw-bank-csv");
    expect(() => parseStatement(lies("bw-bank-mt940.csv"))).toThrow(
      "Das ist der Export „CSV-MT940“ der BW-Bank. Bitte im Online-Banking als Excel (CSV-CAMT V8) exportieren; der enthält alle Angaben vollständig.",
    );
  });

  it("erkennt CSV-CAMT V2 und gefilterte Einträge und verlangt CSV-CAMT V8", () => {
    expect(detectStatementFormat(v2())).toBe("bw-bank-csv");
    expect(() => parseStatement(v2())).toThrow(
      "Das ist der Export „CSV-CAMT V2“ oder „CSV - gefilterte Einträge“ der BW-Bank. Bitte im Online-Banking als Excel (CSV-CAMT V8) exportieren; der enthält alle Angaben vollständig.",
    );
  });
});
