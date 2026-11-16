import { beforeAll, describe, expect, it } from "vitest";

describe("Steuerangaben im REST-Entwurf", () => {
  let draftCreateSchema: typeof import("./schemas.ts").draftCreateSchema;
  let draftPatchSchema: typeof import("./schemas.ts").draftPatchSchema;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://localhost/haben",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "x".repeat(32),
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "https://haben.example.de",
      HABEN_ENCRYPTION_KEY: process.env.HABEN_ENCRYPTION_KEY ?? Buffer.alloc(32).toString("base64"),
    });
    ({ draftCreateSchema, draftPatchSchema } = await import("./schemas.ts"));
  });

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
