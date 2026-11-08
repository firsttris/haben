import { describe, expect, it } from "vitest";
import { gelernteBezahlung } from "./beleg-vorschlag.ts";

describe("gelernteBezahlung", () => {
  const z = (value: "bank" | "privat" | "kasse", count: number, last = "2026-09-01T10:00:00Z") => ({ value, count, last });

  it("die Bezahlung, mit der die Belege des Lieferanten meist gebucht sind: ab zweimal und mit Mehrheit", () => {
    expect(gelernteBezahlung([z("privat", 3, "2026-10-05T08:00:00Z"), z("bank", 1)])).toEqual({
      value: "privat",
      count: 3,
      total: 4,
      last: "2026-10-05T08:00:00Z",
    });
    expect(gelernteBezahlung([z("kasse", 2)])?.value).toBe("kasse");
  });

  it("kein Vorschlag bei nur einem Beleg, ohne Mehrheit oder ohne Belege", () => {
    expect(gelernteBezahlung([z("privat", 1)])).toBeNull();
    expect(gelernteBezahlung([z("privat", 2), z("bank", 2)])).toBeNull();
    expect(gelernteBezahlung([])).toBeNull();
  });
});
