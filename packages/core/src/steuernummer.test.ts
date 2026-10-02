import { describe, expect, it } from "vitest";
import { finanzamtsnummer, SteuernummerError, toElsterSteuernummer } from "./steuernummer.ts";

describe("toElsterSteuernummer", () => {
  it.each([
    ["BY", "198/113/10010", "9198011310010"],
    ["BW", "93815/08152", "2893081508152"],
    ["BE", "21/815/08150", "1121081508150"],
    ["HE", "013 815 08153", "2613081508153"],
    ["NW", "133/8150/8159", "5133081508159"],
    ["SN", "201/123/12340", "3201012312340"],
    ["TH", "151/815/08156", "4151081508156"],
    ["HH", "02/815/08156", "2202081508156"],
  ] as const)("%s %s", (land, input, expected) => {
    expect(toElsterSteuernummer(input, land)).toBe(expected);
  });

  it("lässt das ELSTER-Format unverändert", () => {
    expect(toElsterSteuernummer("9198011310010", "BY")).toBe("9198011310010");
  });

  it("meldet falsche Länge", () => {
    expect(() => toElsterSteuernummer("12/345", "BY")).toThrow(SteuernummerError);
  });

  it("Finanzamtsnummer", () => {
    expect(finanzamtsnummer("9198011310010")).toBe("9198");
  });
});
