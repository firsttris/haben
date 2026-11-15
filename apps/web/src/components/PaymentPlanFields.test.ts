import { describe, expect, it } from "vitest";
import { parsePlanRows, type PlanRowState } from "./PaymentPlanFields.tsx";

const zeile = (kind: PlanRowState["kind"], value: string): PlanRowState => ({ key: 1, label: " Anzahlung ", kind, value, due: " bei Auftrag " });

describe("parsePlanRows", () => {
  it("liest Prozent als Basispunkte und Beträge als Cent", () => {
    expect(parsePlanRows([zeile("prozent", "30"), zeile("betrag", "1.500,00"), zeile("rest", "")])).toEqual({
      rows: [
        { label: "Anzahlung", due: "bei Auftrag", share: { kind: "prozent", value: 3000 } },
        { label: "Anzahlung", due: "bei Auftrag", share: { kind: "betrag", value: 150_000 } },
        { label: "Anzahlung", due: "bei Auftrag", share: { kind: "rest" } },
      ],
      valid: true,
    });
  });

  it.each([
    ["prozent", "0"],
    ["prozent", "100,01"],
    ["prozent", "abc"],
    ["betrag", "0"],
    ["betrag", "-5"],
    ["betrag", "abc"],
  ] as const)("%s „%s“ ist ungültig", (kind, value) => {
    expect(parsePlanRows([zeile(kind, value)]).valid).toBe(false);
  });

  it("100 % ist gültig, ein Betrag hat keine Obergrenze", () => {
    expect(parsePlanRows([zeile("prozent", "100")]).valid).toBe(true);
    expect(parsePlanRows([zeile("betrag", "250,00")]).valid).toBe(true);
  });
});
