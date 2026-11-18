import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checksumProblem, fileRef, referenced, withChecksum } from "./integritaet.ts";

const datei = () =>
  withChecksum({ format: "haben-einstellungen", version: 1, company: { name: "Muster Design", ort: "Leipzig" }, contacts: [{ name: "Nordwerk" }] });

/** Wie die Datei beim Herunterladen geschrieben und beim Hochladen gelesen wird */
const gelesen = (inhalt: object, einrueckung?: number) => JSON.parse(JSON.stringify(inhalt, null, einrueckung));

describe("Prüfsumme der Einstellungsdatei", () => {
  it("bestätigt eine unveränderte Datei, auch eingerückt oder kompakt geschrieben", () => {
    expect(checksumProblem(gelesen(datei(), 2))).toBeNull();
    expect(checksumProblem(gelesen(datei()))).toBeNull();
  });

  it("ist der SHA-256 des kompakten Inhalts ohne das Feld selbst", () => {
    const { sha256, ...inhalt } = datei();
    expect(sha256).toBe(createHash("sha256").update(JSON.stringify(inhalt)).digest("hex"));
  });

  it("erkennt einen geänderten, fehlenden oder ergänzten Wert", () => {
    const geaendert = gelesen(datei());
    geaendert.company.ort = "Halle";
    expect(checksumProblem(geaendert)).toMatch(/beschädigt oder wurde verändert/);

    const ohneKontakte = gelesen(datei());
    ohneKontakte.contacts = [];
    expect(checksumProblem(ohneKontakte)).toMatch(/Prüfsumme stimmt nicht/);

    const ergaenzt = gelesen(datei());
    ergaenzt.company.mcpEnabled = true;
    expect(checksumProblem(ergaenzt)).toMatch(/Prüfsumme stimmt nicht/);
  });

  it("lehnt eine Datei ohne Prüfsumme oder ohne Objekt ab", () => {
    const { sha256: _, ...ohne } = datei();
    expect(checksumProblem(ohne)).toBe("Der Datei fehlt die Prüfsumme.");
    for (const kein of [null, [], "haben-einstellungen", 1]) expect(checksumProblem(kein)).toBe("Das ist keine Einstellungsdatei von Haben.");
  });
});

describe("Dateien im ZIP", () => {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 17]);

  it("nennt Pfad und SHA-256 der Bytes und liefert sie unverändert zurück", () => {
    const ref = fileRef("logo.png", bytes);
    expect(ref).toEqual({ file: "logo.png", sha256: createHash("sha256").update(bytes).digest("hex") });
    expect(referenced({ "logo.png": bytes }, ref)).toEqual(bytes);
  });

  it("liefert nichts, wenn die Datei fehlt oder nicht zum SHA-256 passt", () => {
    const ref = fileRef("logo.png", bytes);
    expect(referenced({}, ref)).toBeNull();
    expect(referenced({ "logo.png": bytes.subarray(0, 4) }, ref)).toBeNull();
    expect(referenced({ "anderes.png": bytes }, ref)).toBeNull();
    expect(referenced({}, { file: "constructor", sha256: ref.sha256 })).toBeNull();
  });
});
