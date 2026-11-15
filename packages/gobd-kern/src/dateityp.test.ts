import { describe, expect, it } from "vitest";
import { sniff } from "./dateityp.ts";

const bytes = (...teile: (string | number[])[]) => new Uint8Array(teile.flatMap((t) => (typeof t === "string" ? [...Buffer.from(t, "latin1")] : t)));

describe("sniff", () => {
  it("erkennt den Typ am Inhalt", () => {
    expect(sniff(bytes("%PDF-1.7\n"))).toEqual({ kind: "pdf", mimeType: "application/pdf" });
    expect(sniff(bytes([0xff, 0xd8, 0xff, 0xe0]))?.kind).toBe("jpeg");
    expect(sniff(bytes("\x89PNG\r\n\x1a\n"))?.kind).toBe("png");
    expect(sniff(bytes("RIFF\0\0\0\0WEBPVP8 "))?.kind).toBe("webp");
    expect(sniff(bytes("\0\0\0\x18ftypheic"))?.kind).toBe("heic");
    expect(sniff(bytes('<?xml version="1.0"?><Invoice/>'))).toEqual({ kind: "xml", mimeType: "application/xml" });
  });

  it("erkennt XML auch mit BOM und ohne Deklaration", () => {
    expect(sniff(bytes([0xef, 0xbb, 0xbf], "<rsm:CrossIndustryInvoice>"))?.kind).toBe("xml");
    expect(sniff(bytes("  <Invoice>"))?.kind).toBe("xml");
  });

  it("gibt null für Unbekanntes zurück, unabhängig von einer Endung", () => {
    expect(sniff(bytes("Hallo Welt"))).toBeNull();
    expect(sniff(new Uint8Array(0))).toBeNull();
  });
});
