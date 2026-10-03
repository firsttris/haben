import { describe, expect, it } from "vitest";
import { einspruchsfrist, parseBescheiddatum } from "./einspruch.ts";

describe("einspruchsfrist", () => {
  it("rechnet ab 2025 mit vier Tagen Bekanntgabe und einem Monat Frist", () => {
    // Mittwoch, 4. Juni 2025 → Bekanntgabe Sonntag 8.6. → Montag 9.6. ist Pfingstmontag → Dienstag 10.6.
    expect(einspruchsfrist("2025-06-04", "BW")).toEqual({ bekanntgabe: "2025-06-10", fristende: "2025-07-10" });
    // Freitag, 3. Oktober 2025 (Feiertag egal) → Bekanntgabe Dienstag 7.10. → Frist Freitag 7.11.
    expect(einspruchsfrist("2025-10-03", "BW")).toEqual({ bekanntgabe: "2025-10-07", fristende: "2025-11-07" });
  });

  it("rechnet bis 2024 mit drei Tagen", () => {
    expect(einspruchsfrist("2024-03-12", "BW").bekanntgabe).toBe("2024-03-15");
  });

  it("verschiebt das Fristende auf den nächsten Werktag und kennt das Monatsende", () => {
    // Bekanntgabe 31.1.2026 (Samstag) → Montag 2.2. → Frist 2.3.2026
    expect(einspruchsfrist("2026-01-27", "BW")).toEqual({ bekanntgabe: "2026-02-02", fristende: "2026-03-02" });
    // Bekanntgabe 31.3.2026 (Dienstag) → 30.4. (Donnerstag)
    expect(einspruchsfrist("2026-03-27", "BW").fristende).toBe("2026-04-30");
  });
});

describe("parseBescheiddatum", () => {
  it("liest die üblichen Formate", () => {
    expect(parseBescheiddatum("2025-06-30")).toBe("2025-06-30");
    expect(parseBescheiddatum("30.06.2025")).toBe("2025-06-30");
    expect(parseBescheiddatum("20250630")).toBe("2025-06-30");
    expect(parseBescheiddatum("31.02.2025")).toBeNull();
    expect(parseBescheiddatum("")).toBeNull();
  });
});
