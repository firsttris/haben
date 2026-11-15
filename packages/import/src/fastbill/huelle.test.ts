import { describe, expect, it } from "vitest";
import { unwrapFormUpload } from "./huelle.ts";

// Aufbau wie an echten Ausgabenbelegen aus FastBill (November 2026); Kennung, Name und Inhalt erfunden
const enc = new TextEncoder();
const PDF = enc.encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const BOUNDARY = "-------------------------------11112222333344";

function wrapped(content: Uint8Array, options: { boundary?: string; closing?: string; headers?: string; trailer?: string } = {}): Uint8Array {
  const boundary = options.boundary ?? BOUNDARY;
  const head = enc.encode(
    `${boundary}\r\n${options.headers ?? 'Content-Disposition: form-data; name="beleg.pdf"; filename="beleg.pdf"\r\nContent-Type: application/x-gzip'}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n${options.closing ?? `${boundary}--`}${options.trailer ?? "\r\n"}`);
  return new Uint8Array([...head, ...content, ...tail]);
}

describe("unwrapFormUpload", () => {
  it("holt das PDF Byte für Byte aus der Hülle des Formular-Uploads", () => {
    expect(unwrapFormUpload(wrapped(PDF))).toEqual(PDF);
  });

  it("verträgt eine Hülle ohne Zeilenende nach der schließenden Trennzeile", () => {
    expect(unwrapFormUpload(wrapped(PDF, { trailer: "" }))).toEqual(PDF);
  });

  it("lässt eine gewöhnliche Datei unberührt", () => {
    expect(unwrapFormUpload(PDF)).toBeNull();
    expect(unwrapFormUpload(enc.encode("--\r\nkein Formular\r\n\r\nx\r\n----"))).toBeNull();
  });

  it.each([
    ["ohne form-data im Kopf", { headers: "Content-Type: application/pdf" }],
    ["mit anderer schließender Trennzeile", { closing: "---------anders--" }],
    ["ohne schließende Trennzeile", { closing: "" }],
  ])("lehnt eine Hülle %s ab", (_name, options) => {
    expect(unwrapFormUpload(wrapped(PDF, options))).toBeNull();
  });

  it("nimmt nur genau einen Teil", () => {
    const two = new Uint8Array([...PDF, ...enc.encode(`\r\n${BOUNDARY}\r\nContent-Disposition: form-data; name="b"\r\n\r\n`), ...PDF]);
    expect(unwrapFormUpload(wrapped(two))).toBeNull();
  });

  it("lehnt einen leeren Teil ab", () => {
    expect(unwrapFormUpload(wrapped(new Uint8Array()))).toBeNull();
  });
});
