import { describe, expect, it } from "vitest";
import { abgabePille, elsterNotice, finanzamtFakten, jahresergebnisFakt, submitKind, zahllastFakt } from "./elster.ts";

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

  // Einkommensteuer: ohne Vermerk in Haben ist „offen“ dort keine Pflicht (#869)
  it("sagt bei der Einkommensteuer, dass Haben sie nicht übermittelt hat", () => {
    // Haben kann die ESt selbst senden (Senden-Kasten der Seite); "außerhalb von Haben"
    // stand deshalb auch dort, wo jemand gleich aus Haben senden wollte (#869).
    expect(abgabePille({ sent: null, submitted: null, verwaltet: false })).toEqual({
      ok: false,
      text: "Nicht aus Haben übermittelt",
    });
  });

  it("bleibt bei einer Übermittlung aus Haben oder einem Vermerk genauer", () => {
    expect(abgabePille({ sent: "2025-08-14T10:00:00Z", submitted: null, verwaltet: false }).text).toBe("Übermittelt am 14.08.2025");
    expect(abgabePille({ sent: null, submitted: vermerk, verwaltet: false }).text).toBe("Außerhalb abgegeben am 29.09.2025");
  });

  // Kleinunternehmer ab 2024 geben keine Umsatzsteuererklärung ab (§ 18 Abs. 3 UStG): nichts offen, nichts zu tun
  it("sagt bei einer nicht geschuldeten Erklärung „Keine Erklärung nötig“, nach Sendung oder Vermerk weiter das Genauere", () => {
    expect(abgabePille({ sent: null, submitted: null, geschuldet: false })).toEqual({ ok: true, text: "Keine Erklärung nötig" });
    expect(abgabePille({ sent: "2025-08-14T10:00:00Z", submitted: null, geschuldet: false }).text).toBe("Übermittelt am 14.08.2025");
    expect(abgabePille({ sent: null, submitted: vermerk, geschuldet: false }).text).toBe("Außerhalb abgegeben am 29.09.2025");
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

describe("jahresergebnisFakt", () => {
  it("nennt bei der Umsatzsteuer die Abschlusszahlung, bei Überschuss die Erstattung ohne Minus", () => {
    expect(jahresergebnisFakt("ust", 97280)).toMatchObject({ label: "Abschlusszahlung", strong: true });
    expect(jahresergebnisFakt("ust", 97280)?.value).toMatch(/^972,80\s€$/);
    expect(jahresergebnisFakt("ust", -5000)).toMatchObject({ label: "Erstattung" });
    expect(jahresergebnisFakt("ust", -5000)?.value).toMatch(/^50,00\s€$/);
  });

  it("nennt bei der EÜR Gewinn oder Verlust, auch bei 0 €", () => {
    expect(jahresergebnisFakt("euer", 609280)).toMatchObject({ label: "Gewinn" });
    expect(jahresergebnisFakt("euer", 609280)?.value).toMatch(/^6\.092,80\s€$/);
    expect(jahresergebnisFakt("euer", -100)).toMatchObject({ label: "Verlust" });
    expect(jahresergebnisFakt("euer", 0)).toMatchObject({ label: "Gewinn" });
  });

  it("nennt bei der Einkommensteuer den Gewinn laut EÜR und lässt die Zeile bei 0 € weg", () => {
    expect(jahresergebnisFakt("est", 609280)).toMatchObject({ label: "Gewinn laut EÜR" });
    expect(jahresergebnisFakt("est", -100)).toMatchObject({ label: "Verlust laut EÜR" });
    expect(jahresergebnisFakt("est", 0)).toBeNull();
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
