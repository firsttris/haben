import { describe, expect, it } from "vitest";
import { glaeubigerIdProblem, mandatsreferenzProblem, mandatStatus, normalizeGlaeubigerId } from "./sepa-mandat.ts";

describe("Gläubiger-Identifikationsnummer", () => {
  it("nimmt die Test-ID der Bundesbank an, auch mit Leerzeichen und klein geschrieben", () => {
    expect(glaeubigerIdProblem("DE98ZZZ09999999999")).toBeNull();
    expect(normalizeGlaeubigerId(" de98 zzz 0999 9999 999 ")).toBe("DE98ZZZ09999999999");
    expect(glaeubigerIdProblem(" de98 zzz 0999 9999 999 ")).toBeNull();
  });

  it("rechnet die Prüfziffer ohne die Geschäftsbereichskennung", () => {
    // Die Kennung (Stellen 5 bis 7) wählt der Gläubiger frei; sie geht nicht in die Prüfziffer ein
    expect(glaeubigerIdProblem("DE98ABC09999999999")).toBeNull();
  });

  it("lehnt eine falsche Prüfziffer ab", () => {
    expect(glaeubigerIdProblem("DE97ZZZ09999999999")).toBe("Die Prüfziffer der Gläubiger-ID stimmt nicht.");
  });

  it("verlangt in Deutschland 18 Stellen mit elf Ziffern am Ende", () => {
    expect(glaeubigerIdProblem("DE98ZZZ0999999999")).toBe(
      "Eine deutsche Gläubiger-ID hat 18 Stellen: DE, zwei Prüfziffern, drei Zeichen Kennung, elf Ziffern.",
    );
    expect(glaeubigerIdProblem("DE98ZZZ0999999999X")).toBe(
      "Eine deutsche Gläubiger-ID hat 18 Stellen: DE, zwei Prüfziffern, drei Zeichen Kennung, elf Ziffern.",
    );
  });

  it("lehnt Unsinn ab", () => {
    expect(glaeubigerIdProblem("")).toBe("Die Gläubiger-ID fehlt.");
    expect(glaeubigerIdProblem("12345")).toBe("Die Gläubiger-ID beginnt mit dem Ländercode und zwei Prüfziffern, z. B. DE98ZZZ09999999999.");
  });
});

describe("Mandatsreferenz", () => {
  it("erlaubt bis zu 35 Zeichen aus dem Zeichensatz des Schemas der DK", () => {
    expect(mandatsreferenzProblem("KD-1042/2026")).toBeNull();
    expect(mandatsreferenzProblem("A".repeat(35))).toBeNull();
    expect(mandatsreferenzProblem("Mandat 7 (Wartung)")).toBeNull();
  });

  it("lehnt leere, zu lange und Referenzen mit anderen Zeichen ab", () => {
    expect(mandatsreferenzProblem("")).toBe("Die Mandatsreferenz fehlt.");
    expect(mandatsreferenzProblem("A".repeat(36))).toBe("Die Mandatsreferenz hat höchstens 35 Zeichen.");
    expect(mandatsreferenzProblem("Müller_1")).toBe("Die Mandatsreferenz darf nur A–Z, a–z, 0–9, Leerzeichen und + ? / - : ( ) . , ' enthalten.");
  });
});

describe("Status des Mandats", () => {
  const mandat = { signedOn: "2023-03-15", lastCollectionOn: null, revokedOn: null };

  it("gilt 36 Monate ab der Unterschrift, solange nicht eingezogen wurde", () => {
    expect(mandatStatus(mandat, "2026-03-14")).toEqual({ art: "gueltig", bis: "2026-03-14" });
    expect(mandatStatus(mandat, "2026-03-15")).toEqual({ art: "abgelaufen", seit: "2026-03-15" });
  });

  it("zählt die 36 Monate ab dem letzten Einzug", () => {
    expect(mandatStatus({ ...mandat, lastCollectionOn: "2025-01-31" }, "2027-06-01")).toEqual({ art: "gueltig", bis: "2028-01-30" });
    expect(mandatStatus({ ...mandat, lastCollectionOn: "2025-01-31" }, "2028-01-31")).toEqual({ art: "abgelaufen", seit: "2028-01-31" });
  });

  it("rechnet am Monatsende auf den letzten Tag des Zielmonats", () => {
    // 29. Februar 2024 plus 36 Monate: 2027 hat keinen 29. Februar, das Mandat gilt bis einschließlich 27. Februar
    expect(mandatStatus({ ...mandat, signedOn: "2024-02-29" }, "2027-02-27")).toEqual({ art: "gueltig", bis: "2027-02-27" });
    expect(mandatStatus({ ...mandat, signedOn: "2024-02-29" }, "2027-02-28")).toEqual({ art: "abgelaufen", seit: "2027-02-28" });
  });

  it("ein Widerruf geht vor, ab seinem Tag", () => {
    expect(mandatStatus({ ...mandat, revokedOn: "2024-05-02" }, "2024-05-01")).toEqual({ art: "gueltig", bis: "2026-03-14" });
    expect(mandatStatus({ ...mandat, revokedOn: "2024-05-02" }, "2024-05-02")).toEqual({ art: "widerrufen", seit: "2024-05-02" });
  });

  it("vor der Unterschrift gilt es noch nicht", () => {
    expect(mandatStatus(mandat, "2023-03-14")).toEqual({ art: "noch-nicht", ab: "2023-03-15" });
  });
});
