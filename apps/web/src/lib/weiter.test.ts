import { describe, expect, it } from "vitest";
import { weiterNachAnmeldung } from "./weiter.ts";

describe("weiterNachAnmeldung", () => {
  it("kehrt nur zur Zustimmungsseite zurück", () => {
    const ziel = "/oauth/autorisieren?client_id=abc&state=1e5";
    expect(weiterNachAnmeldung(`?weiter=${encodeURIComponent(ziel)}`)).toBe(ziel);
  });

  it("lehnt fremde und andere Ziele ab", () => {
    for (const ziel of ["https://evil.example/oauth/autorisieren?", "//evil.example", "/einstellungen", "/oauth/autorisieren"])
      expect(weiterNachAnmeldung(`?weiter=${encodeURIComponent(ziel)}`)).toBeNull();
    expect(weiterNachAnmeldung("")).toBeNull();
  });
});
