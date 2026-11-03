import { describe, expect, it } from "vitest";
import { detectStatementFormat, parseStatement, withDedupHashes } from "./index.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const brief = (s: ReturnType<typeof parseStatement>) => s.transactions.map((t) => [t.bookingDate, t.amount, t.counterpartyName, t.purpose]);

// Spaltennamen nach der eBay-Hilfe 4847 „Abgleichen Ihrer eBay-Verkaufstransaktionen“; Daten erfunden
const germanHeader = `"Datum der Transaktionserstellung";"Typ";"Bestellnr.";"Name des Käufers";"Nettobetrag";"Auszahlungswährung";"Auszahlungsdatum";"Auszahlung Nr.";"Auszahlungsstatus";"Referenz Nr.";"Angebotstitel";"Fixer Anteil der Verkaufsprovision";"Variabler Anteil der Verkaufsprovision";"Internationale Gebühr";"Transaktionsbetrag (inkl. Kosten)";"Transaktionswährung";"Beschreibung"`;
const german = (rows: string[]) => bytes([germanHeader, ...rows].join("\n"));

const sale = `"03.10.2026";"Bestellung";"12-11111-11111";"K. Muster";"52,56";"EUR";"12.10.2026";"6001234567";"Bezahlt";"";"Bilderrahmen 40x50";"-0,35";"-6,99";"0";"59,90";"EUR";""`;
const refund = `"06.10.2026";"Rückerstattung";"12-33333-33333";"C. Probe";"-21,99";"EUR";"12.10.2026";"6001234567";"Bezahlt";"RF-0815";"Bildhaken Set";"0";"2,91";"0";"-24,90";"EUR";""`;
const subscription = `"07.10.2026";"Andere Gebühr";"";"";"-9,95";"EUR";"12.10.2026";"6001234567";"Bezahlt";"FEE-0007";"";"";"";"";"";"";"Shop-Abonnement Basis Oktober 2026"`;
const label = `"08.10.2026";"Versandetikett";"12-11111-11111";"";"-4,95";"EUR";"12.10.2026";"6001234567";"Bezahlt";"LBL-0001";"";"";"";"";"";"";"Versandetikett DHL Paket"`;
const payout = `"12.10.2026";"Auszahlung";"";"";"-15,67";"EUR";"12.10.2026";"6001234567";"Bezahlt";"";"";"";"";"";"";"";"Auszahlung an Bankkonto ****3000"`;

describe("eBay-Transaktionsbericht", () => {
  it("erkennt den deutschen Bericht, trennt Brutto und Gebühren, übernimmt Gebühren, Etikett und Auszahlung", () => {
    const file = german([sale, refund, subscription, label, payout]);
    expect(detectStatementFormat(file)).toBe("ebay-csv");
    const s = parseStatement(file, "ebay.csv");
    expect(s.format).toBe("ebay-csv");
    expect(brief(s)).toEqual([
      ["2026-10-03", 5990, "K. Muster", "Bestellung · Bestellung 12-11111-11111 · Bilderrahmen 40x50"],
      ["2026-10-03", -734, "eBay", "Gebühr · Bestellung · Bestellung 12-11111-11111 · Bilderrahmen 40x50"],
      ["2026-10-06", -2490, "C. Probe", "Rückerstattung · Bestellung 12-33333-33333 · Bildhaken Set · RF-0815"],
      // Bei der Erstattung schreibt eBay einen Teil der Provision gut
      ["2026-10-06", 291, "eBay", "Gebühr · Rückerstattung · Bestellung 12-33333-33333 · Bildhaken Set · RF-0815"],
      ["2026-10-07", -995, "eBay", "Andere Gebühr · Shop-Abonnement Basis Oktober 2026 · FEE-0007"],
      ["2026-10-08", -495, "eBay", "Versandetikett · Bestellung 12-11111-11111 · Versandetikett DHL Paket · LBL-0001"],
      ["2026-10-12", -1567, "eBay", "Auszahlung · Auszahlung an Bankkonto ****3000"],
    ]);
    expect(s.transactions.map((t) => t.type)).toEqual(["Bestellung", "Gebühr", "Rückerstattung", "Gebühr", "Andere Gebühr", "Versandetikett", "Auszahlung"]);
    expect(s.transactions[3]!.bankReference).toBe("RF-0815-gebuehr");
    expect(s.warnings).toEqual([]);
    expect([s.periodFrom, s.periodTo]).toEqual(["2026-10-03", "2026-10-12"]);
  });

  it("ältere Spaltennamen (Betrag abzügl. Kosten, Bestellnummer, Auszahlungsnr.)", () => {
    const header = `"Transaktionsdatum";"Typ";"Bestellnummer";"Betrag abzügl. Kosten";"Auszahlungsnr.";"Transaktionsbetrag (inkl. Kosten)"`;
    const s = parseStatement(bytes([header, `"03.10.2026";"Bestellung";"12-1";"8,50";"";"10,00"`].join("\n")));
    expect(s.format).toBe("ebay-csv");
    expect(brief(s)).toEqual([
      ["2026-10-03", 1000, "eBay", "Bestellung · Bestellung 12-1"],
      ["2026-10-03", -150, "eBay", "Gebühr · Bestellung · Bestellung 12-1"],
    ]);
  });

  it("englischer Bericht mit Vorspann, Komma, Dezimalpunkt und „--“ in leeren Feldern; nicht als PayPal erkannt", () => {
    const file = bytes(
      [
        `"Transaction report"`,
        `"Start date","Oct 1, 2026"`,
        `"End date","Oct 31, 2026"`,
        "",
        `"Transaction creation date","Type","Order number","Buyer name","Net amount","Payout currency","Payout ID","Reference ID","Item title","Final Value Fee - fixed","Final Value Fee - variable","Gross transaction amount","Transaction currency","Transaction ID","Description"`,
        `"2026-10-03","Order","12-11111-11111","K. Muster","52.56","EUR","6001234567","--","Picture frame","-0.35","-6.99","59.90","EUR","2200000000001","--"`,
        `"2026-10-12","Payout","--","--","-52.56","EUR","6001234567","--","--","--","--","--","--","--","Payout to bank account"`,
      ].join("\n"),
    );
    expect(detectStatementFormat(file)).toBe("ebay-csv");
    const s = parseStatement(file);
    expect(brief(s)).toEqual([
      ["2026-10-03", 5990, "K. Muster", "Order · Bestellung 12-11111-11111 · Picture frame · 2200000000001"],
      ["2026-10-03", -734, "eBay", "Gebühr · Order · Bestellung 12-11111-11111 · Picture frame · 2200000000001"],
      ["2026-10-12", -5256, "eBay", "Payout · Payout to bank account"],
    ]);
    expect(s.warnings).toEqual([]);
  });

  it("überspringt Auszahlungen in fremder Währung und Artikelzeilen eines Multikaufs, Käufer in Pfund nur netto", () => {
    const gbp = `"04.10.2026";"Bestellung";"12-2";"J. Smith";"51,68";"GBP";"";"";"";"";"Rahmen";"-0,30";"-7,02";"-1,00";"60,00";"GBP";""`;
    const detail = `"05.10.2026";"Bestellung";"12-3";"";"";"EUR";"";"";"";"";"Zweiter Artikel";"";"";"";"";"";""`;
    const buyerInPounds = `"05.10.2026";"Bestellung";"12-4";"A. Brown";"45,10";"EUR";"";"";"Ausstehend";"";"Leinwand";"-0,35";"-5,50";"-1,05";"44,00";"GBP";""`;
    const s = parseStatement(german([gbp, detail, buyerInPounds]));
    expect(brief(s)).toEqual([["2026-10-05", 4510, "A. Brown", "Bestellung · Bestellung 12-4 · Leinwand"]]);
    expect(s.warnings).toEqual([
      "1 Zeile übersprungen: Auszahlung nicht in Euro.",
      "1 Zeile übersprungen: ohne Nettobetrag (Artikelzeilen eines Multikaufs).",
      "1 Zeile in fremder Käuferwährung: nur der Nettobetrag in Euro übernommen, ohne getrennte Gebühr.",
    ]);
  });

  it("Einbehalt mindert die Auszahlung; fehlt ein Teil der Auszahlung im Bericht, weist Haben darauf hin", () => {
    const order = `"14.10.2026";"Bestellung";"12-5";"D. Esempio";"64,69";"EUR";"19.10.2026";"6001234999";"Bezahlt";"";"Leinwand";"-0,35";"-8,76";"-1,20";"75,00";"EUR";""`;
    const hold = `"15.10.2026";"Einbehalt";"12-5";"";"-20,00";"EUR";"19.10.2026";"6001234999";"Bezahlt";"HOLD-0001";"";"";"";"";"";"";"Einbehalt wegen Zahlungsstreitfall"`;
    const paid = `"19.10.2026";"Auszahlung";"";"";"-44,69";"EUR";"19.10.2026";"6001234999";"Bezahlt";"";"";"";"";"";"";"";"Auszahlung an Bankkonto ****3000"`;
    expect(parseStatement(german([order, hold, paid])).warnings).toEqual([]);
    expect(parseStatement(german([hold, paid])).warnings).toEqual([
      "Auszahlung 6001234999: Die Zeilen ergeben nicht den ausgezahlten Betrag. Vermutlich steht ein Teil im Bericht des Vormonats; sonst bitte den Bericht prüfen.",
    ]);
  });

  it("dieselbe Bestellung vor und nach der Auszahlung exportiert: gleicher Hash", () => {
    const before = `"03.10.2026";"Bestellung";"12-11111-11111";"K. Muster";"52,56";"EUR";"";"";"Ausstehend";"";"Bilderrahmen 40x50";"-0,35";"-6,99";"0";"59,90";"EUR";""`;
    const hashes = (row: string) => withDedupHashes(parseStatement(german([row])).transactions).map((t) => t.dedupHash);
    expect(hashes(before)).toEqual(hashes(sale));
  });

  it("ungültiger Betrag nennt die Zeile", () => {
    expect(() => parseStatement(german([sale.replace('"52,56"', '"abc"')]))).toThrow("Ungültiger Betrag „abc“ (Zeile 2).");
  });
});
