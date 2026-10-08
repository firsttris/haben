import { describe, expect, it } from "vitest";
import { elsterNotice, submitKind } from "./elster.ts";

describe("submitKind", () => {
  it("sendet echt nur mit ausgeschaltetem Test-Schalter, wenn echt überhaupt geht", () => {
    expect(submitKind(false, true)).toBe("send");
    expect(submitKind(true, true)).toBe("test");
    // Schon übermittelt oder ohne Hersteller-ID: Schalter zeigt „Test“, also geht auch nur ein Test raus
    expect(submitKind(false, false)).toBe("test");
  });
});

describe("elsterNotice", () => {
  const ok = { ok: true, code: 0, message: "", transferTicket: "T-1" };

  it("meldet Erfolg je Art mit Transfer-Ticket", () => {
    expect(elsterNotice("validate", ok, "Gesendet.")).toEqual({ tone: "ok", text: "ERiC hat die Daten geprüft, keine Fehler." });
    expect(elsterNotice("test", ok, "Gesendet.")?.text).toBe("Testübermittlung erfolgreich. Transfer-Ticket T-1.");
    expect(elsterNotice("send", ok, "Gesendet.")?.text).toBe("Gesendet. Transfer-Ticket T-1.");
  });

  it("meldet Fehler mit Code", () => {
    expect(elsterNotice("send", { ok: false, code: 610001002, message: "Kaputt", transferTicket: null }, "Gesendet.")).toEqual({
      tone: "danger",
      text: "Übermittlung fehlgeschlagen (610001002): Kaputt",
    });
  });
});
