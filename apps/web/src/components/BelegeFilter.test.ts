import { describe, expect, it } from "vitest";
import { filterBelege } from "./BelegeFilter.tsx";

const documents = [
  { id: "a", status: "neu" as const },
  { id: "b", status: "gebucht" as const },
  { id: "c", status: "gebucht" as const, cancelledOn: "2026-01-02" },
];

describe("filterBelege", () => {
  it("zeigt ohne Filter alle Belege", () => {
    expect(filterBelege(documents, undefined)).toEqual(documents);
  });

  it("„Zu prüfen“ zeigt nur ungebuchte Belege", () => {
    expect(filterBelege(documents, "pruefen").map((d) => d.id)).toEqual(["a"]);
  });

  it("„Gebucht“ zeigt auch stornierte Belege, die im Code gebucht bleiben", () => {
    expect(filterBelege(documents, "gebucht").map((d) => d.id)).toEqual(["b", "c"]);
  });

  it("liefert bei keinem Treffer eine leere Liste", () => {
    expect(filterBelege([documents[0]!], "gebucht")).toEqual([]);
  });
});
