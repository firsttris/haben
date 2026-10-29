import { describe, expect, it } from "vitest";
import { invoiceListStatus } from "./lebenszyklus.ts";

describe("Review invoiceListStatus", () => {
  it("eine überzahlte Rechnung ist nach Fälligkeit nicht überfällig (sonst landet sie im Mahnvorschlag)", () => {
    const status = invoiceListStatus(
      { status: "final", kind: "rechnung", gross: 11_900, paid: 12_000, cancelled: false, dueDate: "2026-05-01" },
      "2026-05-15",
    );
    expect(status).not.toBe("ueberfaellig");
  });
});
