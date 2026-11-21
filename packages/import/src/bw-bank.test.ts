import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectStatementFormat, parseStatement } from "./parse.ts";

const lies = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "..", "test-fixtures", name)));
const ersetzt = (name: string, von: string, nach: string) => new TextEncoder().encode(new TextDecoder("windows-1252").decode(lies(name)).replace(von, nach));

describe("BW-Bank-CSV (CSV-CAMT)", () => {
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

describe("BW-Bank-CSV (CSV-MT940)", () => {
  const auszug = parseStatement(lies("bw-bank-mt940.csv"), "umsatz.csv");
  const t = auszug.transactions;

  it("liest IBAN aus „Kontonummer“ und die SEPA-Felder aus dem Verwendungszweck", () => {
    expect(auszug.format).toBe("bw-bank-csv");
    expect(t[0]).toMatchObject({
      amount: -1856,
      counterpartyIban: "DE89370400440532013000",
      purpose: "7001/. Domains, Ihr Einkauf",
      endToEndId: "E2E-77",
      mandateReference: "MANDAT-1",
      creditorId: "DE98ZZZ09999999999",
    });
  });

  it("lässt einen Zweck ohne Felder, wie er ist", () => {
    expect(t[1]?.purpose).toBe("Rechnung 2026-034 Müller & Söhne");
  });

  it("behält den ganzen Zweck, wenn Felder ohne SVWZ+ darin stehen", () => {
    const s = parseStatement(ersetzt("bw-bank-mt940.csv", '"Rechnung 2026-034 Müller & Söhne";"Müller', '"EREF+2026-034 Müller & Söhne";"Müller'));
    expect(s.transactions[1]).toMatchObject({ endToEndId: "2026-034 Müller & Söhne", purpose: "EREF+2026-034 Müller & Söhne" });
  });
});
