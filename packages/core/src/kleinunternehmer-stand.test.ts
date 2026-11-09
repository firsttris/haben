import { describe, expect, it } from "vitest";
import { kleinunternehmerAm, kleinunternehmerImMonat } from "./kleinunternehmer-stand.ts";

describe("Kleinunternehmer-Stand aus dem Protokoll (#276)", () => {
  const stand = {
    aenderungen: [
      { date: "2026-01-02", value: true },
      { date: "2026-10-15", value: false },
    ],
    aktuell: false,
  };

  it("liest den Stand am Ende eines Tages, vor dem ersten Eintrag den ersten bekannten", () => {
    expect(kleinunternehmerAm(stand, "2025-12-31")).toBe(true);
    expect(kleinunternehmerAm(stand, "2026-10-14")).toBe(true);
    expect(kleinunternehmerAm(stand, "2026-10-15")).toBe(false);
    expect(kleinunternehmerAm({ aenderungen: [], aktuell: true }, "2026-05-01")).toBe(true);
  });

  it("liest den Stand am Ende des Monats", () => {
    expect(kleinunternehmerImMonat(stand, "2026-09-03")).toBe(true);
    expect(kleinunternehmerImMonat(stand, "2026-10-01")).toBe(false);
    expect(kleinunternehmerImMonat(stand, "2026-02-10")).toBe(true);
  });
});
