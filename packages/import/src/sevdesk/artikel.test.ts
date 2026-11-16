import { describe, expect, it } from "vitest";
import { mapSevPart, resolveSevUnity, type SevUnitOption } from "./artikel.ts";
import type { SevPart, SevUnity } from "./types.ts";

/* Erfundene Artikel in der Form von GET /Part (Model_Part der OpenAPI): Beträge und IDs als Text wie in der API */

const piece: SevUnity = { id: "1", objectName: "Unity", name: "Stk", translationCode: "UNITY_PIECE", uneceTradeUnitCode: "C62" };
const days: SevUnity = { id: "13", objectName: "Unity", name: "Tag(e)", translationCode: "UNITY_DAYS", uneceTradeUnitCode: "DAY" };
const percent: SevUnity = { id: "11", objectName: "Unity", name: "%", translationCode: "UNITY_PERCENT", uneceTradeUnitCode: "C62" };
const year: SevUnity = { id: "900001", objectName: "Unity", name: "Jahr", translationCode: null, uneceTradeUnitCode: "ANN" };

function part(over: Partial<SevPart> = {}): SevPart {
  return {
    id: "5001",
    objectName: "Part",
    name: "Beratung Probe",
    partNumber: "ART-1",
    text: null,
    unity: { id: "1", objectName: "Unity" },
    price: "120.00",
    priceNet: "120.00",
    priceGross: "142.80",
    pricePurchase: null,
    taxRate: "19",
    status: "100",
    internalComment: null,
    stock: "0",
    stockEnabled: "0",
    image: null,
    ...over,
  };
}

describe("mapSevPart", () => {
  it("bildet Nummer, Bezeichnung, Nettopreis in Cent und Steuersatz in Basispunkten ab", () => {
    const result = mapSevPart(part({ text: "Zeile 1<br>Zeile 2", internalComment: "nur intern" }), piece, []);
    expect(result).toEqual({
      ok: true,
      article: {
        sevdeskId: "5001",
        number: "ART-1",
        description: "Beratung Probe",
        detail: "Zeile 1\nZeile 2",
        unit: "Stk.",
        unitPrice: 12000,
        taxRate: 1900,
        priceIncludesTax: false,
        note: "nur intern",
        archived: false,
      },
      ignored: [],
    });
  });

  it("nimmt den Bruttopreis nur ohne Nettopreis, dann als Preis inklusive Umsatzsteuer", () => {
    const result = mapSevPart(part({ price: null, priceNet: null, priceGross: "10.70", taxRate: "7" }), piece, []);
    expect(result).toMatchObject({ ok: true, article: { unitPrice: 1070, priceIncludesTax: true, taxRate: 700 } });
  });

  it("rundet Euro kaufmännisch auf Cent", () => {
    expect(mapSevPart(part({ priceNet: "1.005" }), piece, [])).toMatchObject({ article: { unitPrice: 101 } });
  });

  it("archiviert inaktive Artikel (status 50)", () => {
    expect(mapSevPart(part({ status: "50" }), piece, [])).toMatchObject({ ok: true, article: { archived: true } });
  });

  it("lässt Artikel mit anderem Steuersatz mit Grund draußen", () => {
    expect(mapSevPart(part({ taxRate: "16" }), piece, [])).toEqual({ ok: false, reason: "Steuersatz 16 %; Haben kennt 19, 7 und 0 %" });
  });

  it("lässt Artikel ohne passende Einheit draußen und nennt die Einheit", () => {
    const result = mapSevPart(part(), percent, []);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("Einheit „%“ gibt es in Haben nicht");
    expect(mapSevPart(part(), undefined, [])).toEqual({ ok: false, reason: "Einheit in sevDesk nicht gefunden" });
  });

  it("nennt Angaben ohne Feld in Haben", () => {
    const result = mapSevPart(part({ pricePurchase: "50.00", stockEnabled: "1", stock: "12" }), piece, []);
    expect(result).toMatchObject({ ok: true, ignored: ["Einkaufspreis", "Lagerbestand"] });
  });

  it("verlangt eine Bezeichnung und hält die Längen des Formulars ein", () => {
    expect(mapSevPart(part({ name: "  " }), piece, [])).toEqual({ ok: false, reason: "Bezeichnung fehlt" });
    expect(mapSevPart(part({ partNumber: "N".repeat(51) }), piece, [])).toEqual({ ok: false, reason: "Artikelnummer länger als 50 Zeichen" });
  });
});

describe("resolveSevUnity", () => {
  const own: SevUnitOption[] = [{ label: "Jahr", code: "ANN" }];

  it("erkennt feste Einheiten an der Bezeichnung", () => {
    expect(resolveSevUnity(piece, [])).toBe("Stk.");
    expect(resolveSevUnity({ ...piece, name: "Stunde", uneceTradeUnitCode: "HUR" }, [])).toBe("Std.");
  });

  it("erkennt eine Einheit am UN/ECE-Code, wenn die Bezeichnung abweicht", () => {
    expect(resolveSevUnity(days, [])).toBe("Tag");
  });

  it("erkennt eigene Einheiten von Haben", () => {
    expect(resolveSevUnity(year, own)).toBe("Jahr");
    expect(resolveSevUnity({ ...year, name: "Jahresabo" }, own)).toBe("Jahr");
  });

  it("rät nicht: unbekannte Einheit oder mehrdeutiger Code ergeben null", () => {
    expect(resolveSevUnity(percent, [])).toBeNull();
    expect(resolveSevUnity({ ...year, name: "Jahresabo" }, [...own, { label: "Jahre", code: "ANN" }])).toBeNull();
  });
});
