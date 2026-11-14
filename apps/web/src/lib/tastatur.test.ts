import { afterEach, describe, expect, it, vi } from "vitest";
import { ariaKuerzel, istApple, kuerzelText, tastenNamen } from "./tastatur.ts";

const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";

describe("istApple", () => {
  it("nimmt zuerst userAgentData.platform (Chromium)", () => {
    expect(istApple({ userAgentData: { platform: "macOS" }, platform: "Win32", userAgent: WINDOWS_CHROME })).toBe(true);
    expect(istApple({ userAgentData: { platform: "Windows" }, platform: "MacIntel", userAgent: MAC_SAFARI })).toBe(false);
  });

  it("fällt ohne userAgentData auf navigator.platform zurück (Firefox, Safari)", () => {
    expect(istApple({ platform: "MacIntel", userAgent: WINDOWS_CHROME })).toBe(true);
    expect(istApple({ platform: "iPhone" })).toBe(true);
    expect(istApple({ platform: "iPad" })).toBe(true);
    expect(istApple({ platform: "Linux x86_64", userAgent: MAC_SAFARI })).toBe(false);
  });

  it("fällt bei leerer Plattform auf den User-Agent zurück", () => {
    expect(istApple({ userAgentData: { platform: "" }, platform: "", userAgent: MAC_SAFARI })).toBe(true);
    expect(istApple({ userAgent: IPHONE })).toBe(true);
    expect(istApple({ userAgent: ANDROID })).toBe(false);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("liest ohne Argument den navigator des Browsers", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(istApple()).toBe(true);
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(istApple()).toBe(false);
  });

  it("ist ohne Browser (SSR) und ohne Angaben false", () => {
    vi.stubGlobal("navigator", undefined);
    expect(istApple()).toBe(false);
    expect(istApple({})).toBe(false);
  });
});

describe("Beschriftung", () => {
  it("zeigt mod je System als Strg oder ⌘", () => {
    expect(tastenNamen(["mod", "K"], false)).toEqual(["Strg", "K"]);
    expect(tastenNamen(["mod", "K"], true)).toEqual(["⌘", "K"]);
    expect(kuerzelText(["mod", "Enter"], false)).toBe("Strg+Enter");
    expect(kuerzelText(["mod", "Enter"], true)).toBe("⌘+Enter");
    expect(kuerzelText(["Esc"], true)).toBe("Esc");
  });

  it("nennt für aria-keyshortcuts Strg und Befehlstaste", () => {
    expect(ariaKuerzel(["mod", "K"])).toBe("Control+K Meta+K");
    expect(ariaKuerzel(["Escape"])).toBe("Escape");
  });
});
