import { describe, expect, it } from "vitest";
import { abgabePille, elsterNotice, finanzamtFakten, submitKind, zahllastFakt } from "./elster.ts";

describe("abgabePille", () => {
  const vermerk = { filedOn: "2025-09-29" };

  it("meldet Übermittlung und Abgabe außerhalb mit Datum", () => {
    expect(abgabePille({ sent: "2025-08-14T10:00:00Z", submitted: null })).toEqual({ ok: true, text: "Übermittelt am 14.08.2025" });
    expect(abgabePille({ sent: null, submitted: vermerk })).toEqual({ ok: true, text: "Außerhalb abgegeben am 29.09.2025" });
    // Ohne Tag im Vermerk bleibt es beim Zustand allein
    expect(abgabePille({ sent: null, submitted: { filedOn: null } }).text).toBe("Außerhalb abgegeben");
  });

  it("nennt eine in Haben geführte Erklärung ohne Abgabe offen", () => {
    expect(abgabePille({ sent: null, submitted: null })).toEqual({ ok: false, text: "Noch nicht übermittelt" });
  });

  // Einkommensteuer: Haben führt sie nicht, also ist „offen“ dort keine Pflicht (#869)
  it("zeigt eine nicht geführte Erklärung als außerhalb abgegeben, ohne offene Pflicht", () => {
    expect(abgabePille({ sent: null, submitted: null, verwaltet: false })).toEqual({ ok: false, text: "Wird außerhalb von Haben abgegeben" });
  });

  it("bleibt bei einer Übermittlung aus Haben oder einem Vermerk genauer", () => {
    expect(abgabePille({ sent: "2025-08-14T10:00:00Z", submitted: null, verwaltet: false }).text).toBe("Übermittelt am 14.08.2025");
    expect(abgabePille({ sent: null, submitted: vermerk, verwaltet: false }).text).toBe("Außerhalb abgegeben am 29.09.2025");
  });
});

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

describe("zahllastFakt", () => {
  it("nennt eine Vorauszahlung Zahllast", () => {
    expect(zahllastFakt(128450)).toMatchObject({ label: "Zahllast", strong: true });
    expect(zahllastFakt(128450).value).toMatch(/^1\.284,50\s€$/);
  });

  it("nennt null Euro Zahllast", () => {
    expect(zahllastFakt(0).label).toBe("Zahllast");
  });

  it("nennt einen Überschuss Erstattung und zeigt ihn ohne Minus", () => {
    expect(zahllastFakt(-5000)).toMatchObject({ label: "Erstattung", strong: true });
    expect(zahllastFakt(-5000).value).toMatch(/^50,00\s€$/);
  });
});

describe("finanzamtFakten", () => {
  it("nennt Finanzamt und Steuernummer", () => {
    expect(finanzamtFakten("Finanzamt München", "143/123/45678")).toEqual([
      { label: "Finanzamt", value: "Finanzamt München" },
      { label: "Steuernummer", value: "143/123/45678" },
    ]);
  });

  it("zeigt fehlende Angaben als Strich statt leer", () => {
    expect(finanzamtFakten("", "").map((f) => f.value)).toEqual(["–", "–"]);
  });
});
