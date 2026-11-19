import { describe, expect, it } from "vitest";
import { serviceEntryNote } from "./zeiteintrag.ts";

describe("Hinweiszeile eines Zeiteintrags in der Liste", () => {
  it("fasst Projekt, „nicht abrechenbar“ und Quelle in einer Zeile zusammen", () => {
    expect(serviceEntryNote({ project: "Relaunch Website", nonBillable: true, source: "kimai" })).toBe("Relaunch Website · nicht abrechenbar · aus kimai");
    expect(serviceEntryNote({ project: "Relaunch Website", nonBillable: false, source: null })).toBe("Relaunch Website");
    expect(serviceEntryNote({ project: "", nonBillable: true, source: null })).toBe("nicht abrechenbar");
    expect(serviceEntryNote({ project: "", nonBillable: false, source: null })).toBe("");
  });

  it("nennt Quellen aus dem Umzug mit dem Namen des Programms, andere wie übergeben", () => {
    expect(serviceEntryNote({ project: "", nonBillable: false, source: "fastbill" })).toBe("aus FastBill");
    expect(serviceEntryNote({ project: "", nonBillable: false, source: "sevdesk" })).toBe("aus sevDesk");
    expect(serviceEntryNote({ project: "", nonBillable: false, source: "toString" })).toBe("aus toString");
  });
});
