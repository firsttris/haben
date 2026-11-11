import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStatement } from "./parse.ts";

const datei = readFileSync(join(import.meta.dirname, "..", "test-fixtures", "swan.csv"));

describe("Swan-Kontoauszug", () => {
  const auszug = parseStatement(new Uint8Array(datei), "Swan_Umsaetze_2026-01-01_bis_2026-03-31.csv");

  it("erkennt das Format und den Zeitraum", () => {
    expect(auszug.format).toBe("swan-csv");
    expect(auszug.periodFrom).toBe("2026-01-01");
    expect(auszug.periodTo).toBe("2026-03-31");
  });

  it("liest IBAN und Salden aus dem Kopfblock", () => {
    expect(auszug.accountIban).toBe("DE00123456789012345678");
    expect(auszug.openingBalance).toBe(100_000);
    expect(auszug.closingBalance).toBe(73_129);
  });

  it("setzt den Ausgang negativ und den Eingang positiv", () => {
    expect(auszug.transactions.map((t) => t.amount)).toEqual([-27_000, -1_749, 24_552, -22_674]);
  });

  it("liest das Datum als TT/MM/JJJJ", () => {
    expect(auszug.transactions.map((t) => t.bookingDate)).toEqual(["2026-01-07", "2026-01-12", "2026-02-27", "2026-03-26"]);
  });

  it("nimmt die Gegen-IBAN aus der gefüllten Spalte", () => {
    // Ausgang: Gegenkonto steht in „An (IBAN)“
    expect(auszug.transactions[0]?.counterpartyIban).toBe("DE11111111111111111111");
    // Eingang: Gegenkonto steht in „Von (IBAN)“
    expect(auszug.transactions[2]?.counterpartyIban).toBe("DE22222222222222222222");
  });

  it("übernimmt Name, Buchungsart und Verwendungszweck", () => {
    const [erste] = auszug.transactions;
    expect(erste?.counterpartyName).toBe("Beispiel GmbH");
    expect(erste?.type).toBe("Überweisung");
    expect(erste?.purpose).toBe("Rechnung 1001");
  });
});

describe("Swan-Kontoauszug mit unklaren Zeilen", () => {
  const kopf = "IBAN,DE00123456789012345678\nVon,01/01/2026\nBis,31/01/2026\n\nDatum,Name,Type,Verwendungszweck,Kredit EUR,Debit EUR,Von (IBAN),An (IBAN)\n";

  it("bucht bei gefülltem Eingang und Ausgang so, wie die Warnung es sagt", () => {
    const text = `${kopf}07/01/2026,Beispiel GmbH,Überweisung,Test,"10,00 €","270,00 €",,DE11111111111111111111\n`;
    const auszug = parseStatement(new TextEncoder().encode(text));
    expect(auszug.warnings.join()).toMatch(/der Ausgang gilt/);
    expect(auszug.transactions.map((t) => t.amount)).toEqual([-27_000]);
  });
});
