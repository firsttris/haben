import { describe, expect, it } from "vitest";
import type { AssetFormValues } from "./AssetForm.tsx";
import { assetState, readAsset } from "./asset-form-lesen.ts";

const pkw: AssetFormValues = {
  name: "VW Passat",
  kind: "kfz",
  method: "linear",
  acquisitionDate: "2026-03-15",
  cost: 3_000_000,
  usefulLifeMonths: 72,
  degressiveRate: null,
  linearFromYear: null,
  memoValue: false,
  openingDate: "",
  openingBookValue: 0,
  disposalDate: null,
  privateUse: null,
  note: "",
};

describe("readAsset", () => {
  it("gibt die gespeicherten Werte unverändert zurück", () => {
    const { values, errors } = readAsset(assetState(pkw), false);
    expect(Object.values(errors).every((e) => e === null)).toBe(true);
    expect(values).toEqual(pkw);
  });

  it("nennt fehlende Angaben je Feld und gibt dann keine Werte", () => {
    const { values, errors } = readAsset({ ...assetState(pkw), name: " ", years: "", cost: "abc" }, true);
    expect(values).toBeNull();
    expect(errors.name).toBe("Trag eine Bezeichnung ein.");
    expect(errors.years).toContain("Nutzungsdauer");
    expect(errors.cost).not.toBeNull();
    expect(errors.openingDate).toBe("Wähle den Übernahmestichtag.");
  });

  it("nimmt bei der Privatnutzung den Vorschlag, bis der Satz von Hand gewählt ist", () => {
    const privat = { ...assetState(pkw), privateUsed: true, listPrice: "40.000,00", drive: "verbrenner" as const };
    const vorschlag = readAsset(privat, false);
    expect(vorschlag.effectiveRate).toBe(vorschlag.suggestion);
    expect(vorschlag.values?.privateUse?.rate).toBe(vorschlag.suggestion);
    const vonHand = readAsset({ ...privat, rate: 50, rateTouched: true }, false);
    expect(vonHand.values?.privateUse?.rate).toBe(50);
    expect(vonHand.monthly).not.toBeNull();
  });

  it("verlangt bei Privatnutzung einen Listenpreis", () => {
    const { values, errors } = readAsset({ ...assetState(pkw), privateUsed: true, listPrice: "" }, false);
    expect(values).toBeNull();
    expect(errors.listPrice).not.toBeNull();
  });
});
