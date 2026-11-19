import { describe, expect, it } from "vitest";
import { gemerkteMeldung, merkeMeldung } from "./gemerkte-meldung.ts";

describe("gemerkte Meldung", () => {
  it("bleibt für denselben Besuch stehen, auch wenn die Komponente neu entsteht", () => {
    merkeMeldung("zm-2027-41", "besuch-1", { tone: "ok", text: "1 gemeldete USt-IdNr. beim BZSt angefragt" });
    // Eine neu aufgebaute Komponente liest mit demselben Schlüssel und Besuch
    expect(gemerkteMeldung("zm-2027-41", "besuch-1")).toEqual({ tone: "ok", text: "1 gemeldete USt-IdNr. beim BZSt angefragt" });
  });

  it("gehört nur zu ihrem Besuch und ihrem Schlüssel", () => {
    merkeMeldung("zm-2027-41", "besuch-1", { tone: "ok", text: "angefragt" });
    expect(gemerkteMeldung("zm-2027-41", "besuch-2")).toBeNull();
    expect(gemerkteMeldung("zm-2027-42", "besuch-1")).toBeNull();
  });

  it("lässt sich löschen", () => {
    merkeMeldung("zm-2027-41", "besuch-1", { tone: "danger", text: "Fehler" });
    merkeMeldung("zm-2027-41", "besuch-1", null);
    expect(gemerkteMeldung("zm-2027-41", "besuch-1")).toBeNull();
  });
});
