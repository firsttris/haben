import { describe, expect, it } from "vitest";
import { gleicheSalden, zeilenWieHeute } from "./gegenbuchung.ts";
import type { PostingLine } from "./posting.ts";

describe("Gegenbuchung im heutigen Format (#542)", () => {
  // Bareinnahme bei Ist vor #552: ohne Bemessungsgrundlage an der Umsatzsteuer
  const gebucht: PostingLine[] = [
    { account: "1000", debit: 11_900, credit: 0, taxCode: null },
    { account: "1400", debit: 0, credit: 11_900, taxCode: null },
    { account: "1766", debit: 1_900, credit: 0, taxCode: "USt19" },
    { account: "1776", debit: 0, credit: 1_900, taxCode: "USt19" },
  ];
  const heute: PostingLine[] = gebucht.map((l) => (l.account === "1776" ? { ...l, basis: 10_000 } : l));

  it("nimmt das heutige Format, wenn jedes Konto denselben Saldo hat", () => {
    expect(gleicheSalden(gebucht, heute)).toBe(true);
    expect(zeilenWieHeute(gebucht, heute)).toEqual(heute);
  });

  it("zählt Salden je Konto, nicht Zeilen: aufgeteilte Zeilen auf demselben Konto sind gleich", () => {
    // § 13b mit Privatanteil vor #551: eine Zeile auf den Entnahmen, heute Netto mit Schlüssel und Steuer getrennt
    const alt: PostingLine[] = [{ account: "1800", debit: 35_700, credit: 0, taxCode: null }];
    const neu: PostingLine[] = [
      { account: "1800", debit: 30_000, credit: 0, taxCode: "RC13bEU" },
      { account: "1800", debit: 5_700, credit: 0, taxCode: null },
    ];
    expect(gleicheSalden(alt, neu)).toBe(true);
  });

  it("bleibt bei den gebuchten Zeilen, wenn ein Konto abweicht oder fehlt", () => {
    const anderesKonto = heute.map((l) => (l.account === "1000" ? { ...l, account: "1200" } : l));
    expect(zeilenWieHeute(gebucht, anderesKonto)).toEqual(gebucht);
    const andererBetrag = heute.map((l) => (l.account === "1776" ? { ...l, credit: 1_800 } : l));
    expect(zeilenWieHeute(gebucht, andererBetrag)).toEqual(gebucht);
    expect(zeilenWieHeute(gebucht, heute.slice(0, 2))).toEqual(gebucht);
  });
});
