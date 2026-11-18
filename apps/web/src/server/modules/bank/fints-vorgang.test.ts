import type { FintsAntwort } from "@haben/import";
import { describe, expect, it, vi } from "vitest";
import { type FintsFolge, type FintsSchritt, fintsAblehnung, mitTan, vorgangFortsetzen, vorgangMerken, vorgangVerwerfen } from "./fints-vorgang.ts";

const fertig: FintsSchritt = { art: "fertig", ok: true, meldung: "fertig", hinweise: [], neu: 0 };

describe("Laufende FinTS-Vorgänge", () => {
  it("gilt einmal und nur für die Person, die ihn begonnen hat", async () => {
    const weiter = vi.fn(async (): Promise<FintsSchritt> => fertig);
    const id = vorgangMerken("anna", "tan", weiter);
    await expect(vorgangFortsetzen("bernd", id, { tan: "1" })).rejects.toThrow("Der Vorgang ist abgelaufen oder unbekannt. Bitte neu beginnen.");
    await expect(vorgangFortsetzen("anna", id, { tan: "1" })).resolves.toEqual(fertig);
    await expect(vorgangFortsetzen("anna", id, { tan: "1" })).rejects.toThrow(/abgelaufen oder unbekannt/);
    expect(weiter).toHaveBeenCalledOnce();
  });

  it("läuft nach zehn Minuten ab", async () => {
    const id = vorgangMerken("anna", "tan", async () => fertig, 0);
    await expect(vorgangFortsetzen("anna", id, { tan: "1" }, 10 * 60 * 1000)).rejects.toThrow(/abgelaufen/);
  });

  it("gibt einen abgelaufenen Vorgang samt PIN frei, auch wenn kein weiterer kommt", async () => {
    // Wer das Fenster schließt, statt abzubrechen: Der Client mit der PIN darf nicht bis zum nächsten Vorgang bleiben
    vi.useFakeTimers();
    try {
      const jetzt = Date.now();
      const id = vorgangMerken("anna", "tan", async () => fertig, jetzt);
      vi.advanceTimersByTime(10 * 60 * 1000);
      // Mit dem Zeitpunkt des Anlegens: Nicht das Aufräumen beim Fortsetzen, sondern der Ablauf allein hat ihn entfernt
      await expect(vorgangFortsetzen("anna", id, { tan: "1" }, jetzt)).rejects.toThrow(/abgelaufen/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("verlangt bei der Wahl ein Verfahren und bei der TAN keines", async () => {
    const wahl = vorgangMerken("anna", "verfahren", async () => fertig);
    await expect(vorgangFortsetzen("anna", wahl, {})).rejects.toThrow("Bitte ein TAN-Verfahren wählen.");
    const tan = vorgangMerken("anna", "tan", async () => fertig);
    await expect(vorgangFortsetzen("anna", tan, { verfahren: 921 })).rejects.toThrow(/kein TAN-Verfahren/);
  });

  it("verlangt bei der Wahl der Konten mindestens eines und lässt den Vorgang bis dahin offen", async () => {
    const weiter = vi.fn(async (): Promise<FintsSchritt> => fertig);
    const id = vorgangMerken("anna", "konten", weiter);
    await expect(vorgangFortsetzen("anna", id, {})).rejects.toThrow("Wähle mindestens ein Konto.");
    await expect(vorgangFortsetzen("anna", id, { konten: [] })).rejects.toThrow("Wähle mindestens ein Konto.");
    await expect(vorgangFortsetzen("anna", id, { konten: ["DE02120300000000202051"] })).resolves.toEqual(fertig);
    expect(weiter).toHaveBeenCalledOnce();
    expect(weiter).toHaveBeenCalledWith({ konten: ["DE02120300000000202051"] });
  });

  it("verwirft nur eigene Vorgänge", async () => {
    const id = vorgangMerken("anna", "tan", async () => fertig);
    vorgangVerwerfen("bernd", id);
    vorgangVerwerfen("anna", id);
    await expect(vorgangFortsetzen("anna", id, { tan: "1" })).rejects.toThrow(/abgelaufen/);
  });
});

describe("mitTan", () => {
  const anfrage = (entkoppelt: boolean): FintsAntwort<string> => ({ art: "tan", anfrage: { referenz: "R1", text: "TAN bitte", entkoppelt } });
  const folge = (weiter: FintsFolge<string>["weiter"]): FintsFolge<string> => ({
    weiter,
    fertig: async (wert) => ({ art: "fertig", ok: true, meldung: wert, hinweise: [], neu: 0 }),
    abgelehnt: async (meldung) => ({ art: "fertig", ok: false, meldung, hinweise: [], neu: 0 }),
    ausfall: async (error) => ({ art: "fertig", ok: false, meldung: `Ausfall: ${(error as Error).message}`, hinweise: [], neu: 0 }),
  });

  it("gibt die TAN an die Bank und meldet, was die Bank antwortet", async () => {
    const weiter = vi.fn(async (): Promise<FintsAntwort<string>> => ({ art: "ok", wert: "Umsätze" }));
    const schritt = await mitTan("anna", anfrage(false), folge(weiter));
    expect(schritt).toMatchObject({ art: "tan", text: "TAN bitte", entkoppelt: false, bild: null, hinweis: null });
    if (schritt.art !== "tan") return;
    await expect(vorgangFortsetzen("anna", schritt.vorgang, { tan: " 123456 " })).resolves.toMatchObject({ meldung: "Umsätze" });
    expect(weiter).toHaveBeenCalledWith({ referenz: "R1", tan: "123456" });
  });

  it("schickt bei pushTAN keine TAN mit und meldet ausstehende Freigaben", async () => {
    const weiter = vi
      .fn<FintsFolge<string>["weiter"]>()
      .mockResolvedValueOnce(anfrage(true))
      .mockResolvedValueOnce({ art: "abgelehnt", meldung: "Freigabe abgelehnt.", codes: [9942] });
    const schritt = await mitTan("anna", anfrage(true), folge(weiter));
    if (schritt.art !== "tan") throw new Error("TAN erwartet");
    const ausstehend = await vorgangFortsetzen("anna", schritt.vorgang, { tan: "egal" });
    expect(ausstehend).toMatchObject({ art: "tan", hinweis: "Noch nicht freigegeben. Bitte in der App der Bank bestätigen und dann weiter." });
    expect(weiter).toHaveBeenLastCalledWith({ referenz: "R1", tan: undefined });
    if (ausstehend.art !== "tan") return;
    await expect(vorgangFortsetzen("anna", ausstehend.vorgang, {})).resolves.toMatchObject({ ok: false, meldung: "Freigabe abgelehnt." });
  });

  it("gibt Netzfehler in der Fortsetzung an ausfall", async () => {
    const schritt = await mitTan(
      "anna",
      anfrage(false),
      folge(async () => {
        throw new Error("fetch failed");
      }),
    );
    if (schritt.art !== "tan") throw new Error("TAN erwartet");
    await expect(vorgangFortsetzen("anna", schritt.vorgang, { tan: "1" })).resolves.toMatchObject({ ok: false, meldung: "Ausfall: fetch failed" });
  });
});

describe("Ablehnungen der Bank", () => {
  it("erklärt, wenn die Bank die Registrierungsnummer nicht kennt (9952)", () => {
    const text = fintsAblehnung({ meldung: "Das Kundenprodukt wird nicht unterstützt. (9952)", codes: [9050, 9952] });
    expect(text).toMatch(
      /^Das Kundenprodukt wird nicht unterstützt\. \(9952\) Die Bank kennt die Registrierungsnummer aus FINTS_PRODUKT_ID nicht oder noch nicht\./,
    );
    expect(text).toContain("Tage bis Wochen");
  });

  it("erklärt auch den Code der DK für ein nicht registriertes Produkt (9078)", () => {
    const text = fintsAblehnung({ meldung: "Dialog abgebrochen – FinTS-Produkt ist nicht registriert. (9078)", codes: [9800, 9078] });
    expect(text).toMatch(/\(9078\) Die Bank kennt die Registrierungsnummer aus FINTS_PRODUKT_ID nicht oder noch nicht\./);
  });

  it("lässt andere Ablehnungen, wie die Bank sie schreibt", () => {
    expect(fintsAblehnung({ meldung: "TAN ungültig. (9941)", codes: [9050, 9941] })).toBe("TAN ungültig. (9941)");
  });
});
