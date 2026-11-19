import { describe, expect, it } from "vitest";
import { serviceEntryNote, serviceEntrySource } from "./zeiteintrag.ts";

describe("Hinweiszeile eines Zeiteintrags in der Liste", () => {
  it("fasst Projekt und „nicht abrechenbar“ in einer Zeile zusammen, ohne Quelle", () => {
    expect(serviceEntryNote({ project: "Relaunch Website", nonBillable: true })).toBe("Relaunch Website · nicht abrechenbar");
    expect(serviceEntryNote({ project: "Relaunch Website", nonBillable: false })).toBe("Relaunch Website");
    expect(serviceEntryNote({ project: "", nonBillable: true })).toBe("nicht abrechenbar");
    expect(serviceEntryNote({ project: "", nonBillable: false })).toBe("");
  });
});

describe("Quelle eines Zeiteintrags beim Bearbeiten", () => {
  it("nennt Quellen aus dem Umzug mit dem Namen des Programms, andere wie übergeben", () => {
    expect(serviceEntrySource("fastbill")).toBe("FastBill");
    expect(serviceEntrySource("kimai")).toBe("kimai");
    expect(serviceEntrySource("toString")).toBe("toString");
  });

  it("nimmt nur Quellen, aus denen ein Umzug Zeiten übernimmt: „import“ über die API bleibt „import“ (Review #1548)", () => {
    expect(serviceEntrySource("import")).toBe("import");
    expect(serviceEntrySource("wiso")).toBe("wiso");
  });
});
