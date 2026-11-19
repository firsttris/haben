import { describe, expect, it } from "vitest";
import { certificateUploadNotice } from "./certificate-notice.ts";

describe("Meldung nach dem Hochladen des ELSTER-Zertifikats (#1366)", () => {
  it("nennt das Ablaufdatum, wenn es aus der Datei kam", () => {
    expect(certificateUploadNotice({ validUntil: "2029-11-17", readFromFile: true }, true)).toEqual({
      tone: "ok",
      text: "Zertifikat verschlüsselt gespeichert, gültig bis 17.11.2029.",
    });
  });

  it("ohne PIN wie bisher", () => {
    expect(certificateUploadNotice({ validUntil: null, readFromFile: false }, false)).toEqual({ tone: "ok", text: "Zertifikat verschlüsselt gespeichert." });
    expect(certificateUploadNotice({ validUntil: "2029-10-29", readFromFile: false }, false).text).toBe("Zertifikat verschlüsselt gespeichert.");
  });

  it("mit PIN, die nicht passt: sagt, was gilt und wie das Datum dazukommt", () => {
    expect(certificateUploadNotice({ validUntil: "2029-10-29", readFromFile: false }, true)).toEqual({
      tone: "info",
      text: "Zertifikat verschlüsselt gespeichert. Mit dieser PIN ließ sich das Ablaufdatum nicht aus der Datei lesen; es gilt dein Eintrag.",
    });
    const ohneDatum = certificateUploadNotice({ validUntil: null, readFromFile: false }, true);
    expect(ohneDatum.tone).toBe("info");
    expect(ohneDatum.text).toContain("ohne Ablaufdatum");
    expect(ohneDatum.text).toContain("mit der richtigen PIN noch einmal hoch");
  });
});
