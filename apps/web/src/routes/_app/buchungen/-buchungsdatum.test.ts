import { describe, expect, it } from "vitest";
import { formatDate } from "../../../lib/format.ts";
import { buchungsdatumFehler } from "./-buchungsdatum.ts";

const heute = "2026-11-20";

describe("buchungsdatumFehler", () => {
  it("verlangt ein Datum", () => {
    expect(buchungsdatumFehler("", heute, "umbuchung")).toBe("Wähle das Datum.");
  });

  it("lässt heute und frühere Tage zu, keinen Tag in der Zukunft", () => {
    expect(buchungsdatumFehler(heute, heute, "umbuchung")).toBeNull();
    expect(buchungsdatumFehler("2026-03-15", heute, "umbuchung")).toBeNull();
    expect(buchungsdatumFehler("2026-11-21", heute, "umbuchung")).toBe(`Wähle einen Tag bis ${formatDate(heute)}.`);
  });

  it("verlangt ein Datum, wenn nach dem Leeren des Felds die Eröffnungsbuchung gewählt ist", () => {
    // Die Wahl der Eröffnungsbuchung setzt den Tag auf `${date.slice(0, 4)}-01-01` (neu.tsx), bei leerem Feld also auf „-01-01“
    expect(buchungsdatumFehler("-01-01", heute, "eroeffnung")).toBe("Wähle das Datum.");
  });

  it("verlangt bei einer Eröffnungsbuchung den 1. Januar, die Zukunft geht vor", () => {
    expect(buchungsdatumFehler("2026-01-01", heute, "eroeffnung")).toBeNull();
    expect(buchungsdatumFehler("2026-02-01", heute, "eroeffnung")).toBe("Eine Eröffnungsbuchung steht am 1. Januar; wähle den 1. Januar des Jahres.");
    expect(buchungsdatumFehler("2027-01-01", heute, "eroeffnung")).toBe(`Wähle einen Tag bis ${formatDate(heute)}.`);
  });
});
