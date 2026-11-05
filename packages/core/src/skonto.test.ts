import { describe, expect, it } from "vitest";
import {
  formatPercent,
  parsePercent,
  parseSkontoTerms,
  skontoFristen,
  skontoGezogen,
  skontoOffer,
  skontoPaymentTerms,
  skontoProblem,
  skontoStufenSchema,
  skontoZahlfristen,
} from "./skonto.ts";

describe("parseSkontoTerms", () => {
  it("liest die Skontozeilen nach BR-DE-18 (Beispiel 01.10a der XRechnung-Testsuite)", () => {
    expect(parseSkontoTerms("#SKONTO#TAGE=7#PROZENT=2.00#\n#SKONTO#TAGE=14#PROZENT=1.00#\n#SKONTO#TAGE=30#PROZENT=0.00#\n")).toEqual([
      { days: 7, percent: 200 },
      { days: 14, percent: 100 },
    ]);
  });

  it("liest den Basisbetrag und übergeht andere Texte", () => {
    expect(parseSkontoTerms("Zahlbar in 30 Tagen\r\n#SKONTO#TAGE=10#PROZENT=3.50#BASISBETRAG=100.05#")).toEqual([{ days: 10, percent: 350, base: 10_005 }]);
    expect(parseSkontoTerms("#skonto#tage=7#prozent=2.00#")).toEqual([]);
    expect(parseSkontoTerms("#SKONTO#TAGE=7#PROZENT=2#")).toEqual([]);
    expect(parseSkontoTerms("")).toEqual([]);
  });
});

describe("skontoOffer", () => {
  const terms = [
    { days: 7, percent: 200 },
    { days: 14, percent: 100 },
  ];

  it("nimmt das höchste Skonto, dessen Frist am Zahltag läuft", () => {
    expect(skontoOffer(terms, "2026-11-01", "2026-11-08", 11_900)).toEqual({ term: terms[0], until: "2026-11-08", amount: 238 });
    expect(skontoOffer(terms, "2026-11-01", "2026-11-09", 11_900)).toEqual({ term: terms[1], until: "2026-11-15", amount: 119 });
    expect(skontoOffer(terms, "2026-11-01", "2026-11-16", 11_900)).toBeNull();
  });

  it("rechnet vom Basisbetrag und rundet kaufmännisch", () => {
    expect(skontoOffer([{ days: 10, percent: 300, base: 5_050 }], "2026-11-01", "2026-11-02", 20_000)?.amount).toBe(152);
    expect(skontoOffer([{ days: 10, percent: 200 }], "2026-11-01", "2026-11-02", 25)?.amount).toBe(1);
  });

  it("bietet kein Skonto an, das den ganzen Betrag oder nichts abzöge", () => {
    expect(skontoOffer([{ days: 10, percent: 200 }], "2026-11-01", "2026-11-02", 20)).toBeNull();
    expect(skontoOffer([{ days: 10, percent: 10_000 }], "2026-11-01", "2026-11-02", 500)).toBeNull();
  });
});

describe("skontoPaymentTerms", () => {
  it("schreibt je Stufe eine Zeile nach BR-DE-18, sortiert und mit Zeilenumbruch auch nach der letzten", () => {
    const text = skontoPaymentTerms([
      { days: 14, percent: 100 },
      { days: 7, percent: 250 },
    ]);
    expect(text).toBe("#SKONTO#TAGE=7#PROZENT=2.50#\n#SKONTO#TAGE=14#PROZENT=1.00#\n");
    // Ausdruck XR-SKONTO-REGEX aus itplr-kosit/xrechnung-schematron (common.sch), je Zeile
    const xrSkontoRegex = /(^|\r?\n)#(SKONTO)#TAGE=([0-9]+#PROZENT=[0-9]+\.[0-9]{2})(#BASISBETRAG=-?[0-9]+\.[0-9]{2})?#$/;
    expect(
      text
        .trimEnd()
        .split("\n")
        .every((line) => xrSkontoRegex.test(line)),
    ).toBe(true);
    // Und was Haben schreibt, liest Haben wieder (Eingangsrechnungen)
    expect(parseSkontoTerms(text)).toEqual([
      { days: 7, percent: 250 },
      { days: 14, percent: 100 },
    ]);
    expect(skontoPaymentTerms([])).toBe("");
    expect(skontoPaymentTerms([{ days: 10, percent: 5 }])).toBe("#SKONTO#TAGE=10#PROZENT=0.05#\n");
  });
});

describe("skontoFristen", () => {
  it("rechnet Frist ab Rechnungsdatum und Abzug vom ganzen Betrag, kaufmännisch gerundet", () => {
    expect(
      skontoFristen(
        [
          { days: 20, percent: 100 },
          { days: 10, percent: 200 },
        ],
        "2026-10-02",
        119_025,
      ),
    ).toEqual([
      { days: 10, percent: 200, until: "2026-10-12", amount: 2_381, payable: 116_644 },
      { days: 20, percent: 100, until: "2026-10-22", amount: 1_190, payable: 117_835 },
    ]);
  });

  it("lässt Stufen weg, die nichts abzögen, und bietet bei Gutschriften keins an", () => {
    expect(skontoFristen([{ days: 10, percent: 200 }], "2026-10-02", 20)).toEqual([]);
    expect(skontoFristen([{ days: 10, percent: 200 }], "2026-10-02", -11_900)).toEqual([]);
  });
});

describe("skontoZahlfristen", () => {
  const stufe = [{ days: 10, percent: 200 }];

  it("Fristende an einem Werktag: Zahlung bis zu diesem Tag", () => {
    // 02.10.2026 + 10 Tage = Montag, 12.10.2026
    expect(skontoZahlfristen(stufe, "2026-10-02", 119_025, "BY")).toEqual([
      { days: 10, percent: 200, until: "2026-10-12", paidBy: "2026-10-12", amount: 2_381, payable: 116_644 },
    ]);
  });

  it("Fristende am Sonntag: Zahlung am Montag noch rechtzeitig (§ 193 BGB), das Fristende selbst bleibt", () => {
    // 24.09.2026 + 10 Tage = Sonntag, 04.10.2026
    const [frist] = skontoZahlfristen(stufe, "2026-09-24", 119_025, "BY");
    expect(frist).toMatchObject({ until: "2026-10-04", paidBy: "2026-10-05" });
  });

  it("Fristende am Feiertag des Bundeslands der Firma", () => {
    // Christi Himmelfahrt, Donnerstag 14.05.2026, bundesweit
    expect(skontoZahlfristen(stufe, "2026-05-04", 119_025, null)[0]?.paidBy).toBe("2026-05-15");
    // Fronleichnam, Donnerstag 04.06.2026: Feiertag in Bayern, nicht in Berlin
    expect(skontoZahlfristen(stufe, "2026-05-25", 119_025, "BY")[0]?.paidBy).toBe("2026-06-05");
    expect(skontoZahlfristen(stufe, "2026-05-25", 119_025, "BE")[0]?.paidBy).toBe("2026-06-04");
    // Tag der Deutschen Einheit am Samstag, 03.10.2026: erst Montag, 05.10.
    expect(skontoZahlfristen(stufe, "2026-09-23", 119_025, "BY")[0]?.paidBy).toBe("2026-10-05");
  });
});

describe("skontoGezogen", () => {
  const fristen = skontoZahlfristen(
    [
      { days: 7, percent: 300 },
      { days: 14, percent: 200 },
    ],
    "2026-09-24",
    119_000,
    "BY",
  );

  it("findet die Stufe, deren Zahlbetrag gezahlt wurde, solange die Frist läuft", () => {
    // 3 % bis 01.10.2026: 115.430; 2 % bis 08.10.2026: 116.620
    expect(skontoGezogen(fristen, "2026-10-01", 115_430)).toMatchObject({ percent: 300, amount: 3_570 });
    expect(skontoGezogen(fristen, "2026-10-08", 116_620)).toMatchObject({ percent: 200, amount: 2_380 });
  });

  it("nach der Frist, mit anderem Betrag oder ohne Stufen nichts", () => {
    expect(skontoGezogen(fristen, "2026-10-02", 115_430)).toBeUndefined();
    expect(skontoGezogen(fristen, "2026-10-01", 115_431)).toBeUndefined();
    expect(skontoGezogen(undefined, "2026-10-01", 115_430)).toBeUndefined();
  });
});

describe("skontoProblem", () => {
  it("verlangt Fristen innerhalb des Zahlungsziels, ohne doppelte, und kleinere Sätze für längere Fristen", () => {
    expect(skontoProblem([{ days: 10, percent: 200 }], 14)).toBeNull();
    expect(skontoProblem([{ days: 14, percent: 200 }], 14)).toBeNull();
    expect(skontoProblem([{ days: 15, percent: 200 }], 14)).toBe("Die Skontofrist von 15 Tagen ist länger als das Zahlungsziel von 14 Tagen.");
    expect(
      skontoProblem(
        [
          { days: 10, percent: 200 },
          { days: 10, percent: 100 },
        ],
        30,
      ),
    ).toBe("Die Skontofrist von 10 Tagen steht doppelt.");
    expect(
      skontoProblem(
        [
          { days: 20, percent: 300 },
          { days: 10, percent: 200 },
        ],
        30,
      ),
    ).toBe("Eine längere Skontofrist braucht einen kleineren Satz als die kürzere.");
  });

  it("Schema: ganze Tage und Basispunkte, höchstens drei Stufen", () => {
    expect(skontoStufenSchema.safeParse([{ days: 10, percent: 200 }]).success).toBe(true);
    expect(skontoStufenSchema.safeParse([{ days: 0, percent: 200 }]).success).toBe(false);
    expect(skontoStufenSchema.safeParse([{ days: 10, percent: 10_000 }]).success).toBe(false);
    expect(skontoStufenSchema.safeParse([{ days: 10, percent: 1.5 }]).success).toBe(false);
    expect(skontoStufenSchema.safeParse([1, 2, 3, 4].map((days) => ({ days, percent: 100 - days }))).success).toBe(false);
  });
});

describe("parsePercent und formatPercent", () => {
  it("liest Sätze mit Komma und höchstens zwei Nachkommastellen", () => {
    expect(parsePercent("2")).toBe(200);
    expect(parsePercent("2,5 %")).toBe(250);
    expect(parsePercent("0,75")).toBe(75);
    expect(parsePercent("2,555")).toBeNull();
    expect(parsePercent("-1")).toBeNull();
    expect(parsePercent("")).toBeNull();
  });

  it("schreibt Sätze ohne überflüssige Nullen", () => {
    expect(formatPercent(200)).toBe("2\u00a0%");
    expect(formatPercent(250)).toBe("2,5\u00a0%");
    expect(formatPercent(75)).toBe("0,75\u00a0%");
  });
});
