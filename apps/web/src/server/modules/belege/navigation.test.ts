import { describe, expect, it } from "vitest";
import { documentNavigation } from "./navigation.ts";

const rows = [
  { id: "a", status: "neu" },
  { id: "b", status: "neu" },
  { id: "c", status: "neu" },
  { id: "d", status: "gebucht" },
];

describe("documentNavigation", () => {
  it("liefert Position und Nachbarn in der Reihenfolge der Liste", () => {
    expect(documentNavigation(rows, "b")).toEqual({ position: 2, total: 4, previousId: "a", nextId: "c", nextOpenId: "c" });
  });

  it("hat am Anfang keinen vorigen und am Ende keinen nächsten Beleg", () => {
    expect(documentNavigation(rows, "a")).toMatchObject({ previousId: null, nextId: "b" });
    expect(documentNavigation(rows, "d")).toMatchObject({ previousId: "c", nextId: null });
  });

  it("sucht den nächsten offenen Beleg nach dem aktuellen und beginnt am Ende wieder vorn", () => {
    expect(documentNavigation(rows, "c").nextOpenId).toBe("a");
    expect(documentNavigation(rows, "d").nextOpenId).toBe("a");
  });

  it("schlägt den Beleg selbst nie als nächsten offenen vor", () => {
    expect(documentNavigation([{ id: "a", status: "neu" }, { id: "d", status: "gebucht" }], "a").nextOpenId).toBeNull();
  });

  it("kommt mit einem Beleg zurecht, der nicht in der Liste steht", () => {
    expect(documentNavigation(rows, "x")).toEqual({ position: 0, total: 4, previousId: null, nextId: null, nextOpenId: "a" });
  });
});
