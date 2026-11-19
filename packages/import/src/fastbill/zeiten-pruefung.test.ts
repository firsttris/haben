import { describe, expect, it } from "vitest";
import type { FbTime } from "./types.ts";
import { mapFbTime } from "./zeiten.ts";

// Eingaben, die mapFbTime als übernehmbar durchlässt, die Haben beim Anlegen aber ablehnt. Konstruierte Werte.
const zeit = (fields: Partial<FbTime> = {}): FbTime => ({
  TIME_ID: "4001",
  CUSTOMER_ID: "601",
  PROJECT_ID: "0",
  DATE: "2026-10-14 09:00:00",
  MINUTES: "90",
  BILLABLE_MINUTES: "90",
  COMMENT: "Konzept",
  ...fields,
});

describe("mapFbTime", () => {
  it("lehnt einen Tag ab, den es nicht gibt, statt ihn in der Vorschau als übernehmbar zu zählen", () => {
    const m = mapFbTime(zeit({ DATE: "2026-02-30 09:00:00" }), new Map());
    expect(m.ok).toBe(false);
  });

  it("lehnt eine negative abrechenbare Dauer ab, statt sie mit negativer Summe durchzulassen", () => {
    const m = mapFbTime(zeit({ BILLABLE_MINUTES: "-30" }), new Map());
    expect(m.ok).toBe(false);
  });
});
