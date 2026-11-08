import { describe, expect, it } from "vitest";
import {
  PIN_DEFAULT_WIDTH,
  PIN_MIN_WIDTH,
  PREVIEW_MODE_KEY,
  parsePreviewMode,
  previewLayout,
  readPreviewMode,
  returnsFocusOnClose,
  writePreviewMode,
} from "./vorschau.ts";

describe("previewLayout", () => {
  it("bietet Anheften erst an, wenn Formular und Vorschau ihre Mindestbreite haben", () => {
    expect(previewLayout("angeheftet", PIN_MIN_WIDTH - 1)).toEqual({ canPin: false, pinned: false });
    expect(previewLayout("angeheftet", PIN_MIN_WIDTH)).toEqual({ canPin: true, pinned: true });
  });

  it("zeigt am Handy nur die Überblendung, auch wenn das Gerät sonst angeheftet ist", () => {
    expect(previewLayout("angeheftet", 343)).toEqual({ canPin: false, pinned: false });
  });

  it("heftet ohne gespeicherte Wahl nur auf dem großen Bildschirm an", () => {
    // 14-Zoll-Laptop (1470 px Fenster, #355): Editor rund 1160 px breit
    expect(previewLayout(null, 1158)).toEqual({ canPin: true, pinned: false });
    expect(previewLayout(null, PIN_DEFAULT_WIDTH - 1)).toEqual({ canPin: true, pinned: false });
    expect(previewLayout(null, PIN_DEFAULT_WIDTH)).toEqual({ canPin: true, pinned: true });
  });

  it("folgt der gespeicherten Wahl, wo Anheften geht", () => {
    expect(previewLayout("angeheftet", 1158).pinned).toBe(true);
    expect(previewLayout("ueberblendung", 1900).pinned).toBe(false);
  });

  it("zeigt vor der ersten Messung die Überblendung", () => {
    expect(previewLayout("angeheftet", null)).toEqual({ canPin: false, pinned: false });
  });
});

describe("gespeicherte Wahl", () => {
  it("nimmt nur die bekannten Werte", () => {
    expect(parsePreviewMode("angeheftet")).toBe("angeheftet");
    expect(parsePreviewMode("ueberblendung")).toBe("ueberblendung");
    expect(parsePreviewMode("seitlich")).toBeNull();
    expect(parsePreviewMode(null)).toBeNull();
  });

  it("schreibt und liest unter einem Schlüssel", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v) };
    writePreviewMode(storage, "angeheftet");
    expect(values.get(PREVIEW_MODE_KEY)).toBe("angeheftet");
    expect(readPreviewMode(storage)).toBe("angeheftet");
  });

  it("übersteht einen gesperrten Speicher (privates Fenster)", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readPreviewMode(blocked)).toBeNull();
    expect(() => writePreviewMode(blocked, "angeheftet")).not.toThrow();
    expect(readPreviewMode(undefined)).toBeNull();
  });
});

// Nach Escape ist der Dialog sofort zu, das Ereignis „close“ kommt erst danach als eigener Task (HTML, „close the dialog“).
// Wer in dieser Lücke ins Formular klickt, behält den Fokus; zurück auf den Auslöser nur aus der Leiste oder von nirgends.
describe("returnsFocusOnClose", () => {
  const body = { name: "body" };
  const inOverlay = { name: "Schließen" };
  const formField = { name: "Beschreibung Position 1" };
  const overlayContains = (el: unknown) => el === inOverlay;

  it("holt den Fokus aus der Leiste oder von nirgends zurück auf den Auslöser", () => {
    expect(returnsFocusOnClose(inOverlay, body, overlayContains)).toBe(true);
    expect(returnsFocusOnClose(body, body, overlayContains)).toBe(true);
    expect(returnsFocusOnClose(null, body, overlayContains)).toBe(true);
  });

  it("lässt einen Fokus stehen, den man während der Fahrt hinaus schon gesetzt hat", () => {
    expect(returnsFocusOnClose(formField, body, overlayContains)).toBe(false);
  });
});
