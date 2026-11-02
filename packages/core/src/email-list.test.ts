import { describe, expect, it } from "vitest";
import { firstEmail, joinEmails, splitEmails } from "./email-list.ts";

describe("E-Mail-Liste", () => {
  it("trennt an Komma und Semikolon und lässt leere Einträge weg", () => {
    expect(splitEmails(" rechnung@kunde.de;freigabe@kunde.de ,, ")).toEqual(["rechnung@kunde.de", "freigabe@kunde.de"]);
    expect(splitEmails("")).toEqual([]);
    expect(splitEmails(null)).toEqual([]);
  });

  it("nimmt für die E-Rechnung die erste Adresse", () => {
    expect(firstEmail("rechnung@kunde.de, freigabe@kunde.de")).toBe("rechnung@kunde.de");
    expect(firstEmail("")).toBe("");
  });

  it("verbindet einheitlich mit Komma", () => {
    expect(joinEmails(["a@b.de", "c@d.de"])).toBe("a@b.de, c@d.de");
  });
});
