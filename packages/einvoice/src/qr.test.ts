import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { qrSvg } from "./qr.ts";

describe("qrSvg", () => {
  it("zeichnet jedes dunkle Modul als Quadrat", () => {
    const text = "BCD\n002\n1\nSCT\n\nMax\nDE89370400440532013000\nEUR1.00\n\n\nRechnung 2026-001";
    const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
    const dark = Array.from(modules.data).filter(Boolean).length;
    const svg = qrSvg(text);
    expect(svg).toContain(`viewBox="0 0 ${modules.size} ${modules.size}"`);
    expect(svg.match(/M\d+ \d+h1v1h-1z/g)).toHaveLength(dark);
  });
});
