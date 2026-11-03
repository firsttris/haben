import { describe, expect, it } from "vitest";
import { isKapitalgesellschaft, ownerLabels, RECHTSFORM_KEYS } from "./rechtsform.ts";

describe("Rechtsform", () => {
  it("GmbH und UG sind Kapitalgesellschaften, das Einzelunternehmen nicht", () => {
    expect(RECHTSFORM_KEYS.filter(isKapitalgesellschaft)).toEqual(["gmbh", "ug"]);
  });

  it("nennt Geld vom und an den Inhaber je nach Rechtsform", () => {
    expect(ownerLabels("einzelunternehmen").bank).toBe("Privat (Entnahme oder Einlage)");
    expect(ownerLabels("gmbh").bank).toBe("Gesellschafter (Verrechnungskonto)");
    expect(ownerLabels("ug").cashOut).toBe("An den Gesellschafter");
  });
});
