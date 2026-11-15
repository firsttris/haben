import { describe, expect, it } from "vitest";
import { advanceCheckpoint, type PartResult } from "./index.ts";

const window = { from: "2026-10-01", to: "2026-10-31" };
const part = (index: number, last: boolean, over: Partial<PartResult> = {}, fetchId = "abruf-1"): PartResult => ({
  coverage: window,
  part: { fetchId, index, last },
  blocking: 0,
  conflict: false,
  ...over,
});

describe("advanceCheckpoint", () => {
  it("rückt nach allen Teilen bis zum Ende des Fensters vor", () => {
    expect(advanceCheckpoint("2026-09-30", [part(0, false), part(1, false), part(2, true)])).toEqual({ checkpoint: "2026-10-31", complete: true });
  });

  it("rückt beim ersten Abruf ohne bisherigen Stand vor", () => {
    expect(advanceCheckpoint(undefined, [part(0, true)])).toEqual({ checkpoint: "2026-10-31", complete: true });
  });

  it("bleibt stehen, wenn der letzte Teil fehlt (Abbruch auf einer späteren Seite)", () => {
    expect(advanceCheckpoint("2026-09-30", [part(0, false), part(1, false)])).toEqual({
      checkpoint: "2026-09-30",
      complete: false,
      reason: "Der letzte Teil der Lieferung fehlt.",
    });
  });

  it("bleibt stehen, wenn ein Teil dazwischen fehlt", () => {
    expect(advanceCheckpoint("2026-09-30", [part(0, false), part(2, true)])).toEqual({
      checkpoint: "2026-09-30",
      complete: false,
      reason: "Teil 1 der Lieferung fehlt.",
    });
  });

  it("bleibt stehen bei doppelten Teilen oder einem letzten Teil, der nicht der letzte ist", () => {
    expect(advanceCheckpoint("2026-09-30", [part(0, true), part(1, true)]).complete).toBe(false);
    expect(advanceCheckpoint("2026-09-30", [part(0, false), part(0, true)]).complete).toBe(false);
  });

  it("bleibt stehen, wenn die Teile verschiedene Fenster nennen", () => {
    expect(advanceCheckpoint("2026-09-30", [part(0, false), part(1, true, { coverage: { from: "2026-10-01", to: "2026-10-15" } })])).toEqual({
      checkpoint: "2026-09-30",
      complete: false,
      reason: "Die Teile der Lieferung nennen verschiedene Fenster.",
    });
  });

  it("bleibt stehen bei Fremdwährung oder nicht eingeordneten Ereignissen", () => {
    expect(advanceCheckpoint("2026-09-30", [part(0, false, { blocking: 1 }), part(1, true, { blocking: 2 })])).toEqual({
      checkpoint: "2026-09-30",
      complete: false,
      reason: "3 Ereignisse sind nicht übernommen (fremde Währung oder vom Connector nicht eingeordnet); der Zeitraum bleibt offen.",
    });
  });

  it("bleibt stehen bei einem Konflikt", () => {
    expect(advanceCheckpoint("2026-09-30", [part(0, true, { conflict: true })])).toEqual({
      checkpoint: "2026-09-30",
      complete: false,
      reason: "Die Lieferung hat einen Konflikt mit schon übernommenen Bewegungen.",
    });
  });

  it("bleibt stehen, wenn zwischen Stand und Fenster eine Lücke ist", () => {
    expect(advanceCheckpoint("2026-09-29", [part(0, true)])).toEqual({
      checkpoint: "2026-09-29",
      complete: false,
      reason: "Lücke: vollständig bis 2026-09-29, das Fenster beginnt erst am 2026-10-01.",
    });
  });

  it("nimmt ein überlappendes Fenster für verspätete Bewegungen an", () => {
    expect(advanceCheckpoint("2026-10-20", [part(0, true)])).toEqual({ checkpoint: "2026-10-31", complete: true });
  });

  it("geht nie zurück, wenn ein älteres Fenster noch einmal abgerufen wird", () => {
    expect(advanceCheckpoint("2026-11-15", [part(0, true)])).toEqual({ checkpoint: "2026-11-15", complete: true });
  });

  it("rückt nach einem abgebrochenen Abruf mit dem neuen Abruf desselben Fensters vor", () => {
    const abgebrochen = [part(0, false), part(1, false)];
    const neu = [part(0, false, {}, "abruf-2"), part(1, true, {}, "abruf-2")];
    expect(advanceCheckpoint("2026-09-30", [...abgebrochen, ...neu])).toEqual({ checkpoint: "2026-10-31", complete: true });
  });

  it("rückt bei zwei vollständigen Abrufen desselben Fensters vor", () => {
    expect(advanceCheckpoint("2026-09-30", [part(0, true), part(0, true, {}, "abruf-2")])).toEqual({ checkpoint: "2026-10-31", complete: true });
  });

  it("rückt über aufeinanderfolgende Abrufe vor und nennt einen offenen späteren", () => {
    const november = { from: "2026-11-01", to: "2026-11-30" };
    const dezember = { from: "2026-12-01", to: "2026-12-31" };
    expect(
      advanceCheckpoint("2026-09-30", [part(0, true), part(0, true, { coverage: november }, "abruf-2"), part(0, false, { coverage: dezember }, "abruf-3")]),
    ).toEqual({ checkpoint: "2026-11-30", complete: false, reason: "Der letzte Teil der Lieferung fehlt." });
  });

  it("bleibt ohne Lieferung stehen", () => {
    expect(advanceCheckpoint("2026-09-30", [])).toEqual({ checkpoint: "2026-09-30", complete: false, reason: "Keine Lieferung." });
  });
});
