import { describe, expect, it } from "vitest";
import { draftCreateSchema, draftPatchSchema } from "./schemas.ts";

describe("Steuerangaben im REST-Entwurf", () => {
  const taxDetails = { exemption: { number: "21", letter: null }, ancillary: null, foreignPlace: null, assetDisposal: false };
  it("nimmt die strukturierte Vorschrift über denselben Vertrag wie der Editor an", () => {
    const result = draftCreateSchema.safeParse({
      taxTreatment: "steuerfrei",
      taxDetails,
      lines: [{ description: "Unterricht", quantity: 1000, unit: "Std.", unitPrice: 10_000, taxRate: 0 }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveProperty("taxDetails", taxDetails);
  });

  it("erlaubt explizite Zuordnung und das bewusste Zurücksetzen auf ungeklärt", () => {
    expect(draftPatchSchema.safeParse({ taxDetails }).success).toBe(true);
    expect(draftPatchSchema.safeParse({ taxDetails: null }).success).toBe(true);
  });
});
