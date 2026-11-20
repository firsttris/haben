import { describe, expect, it } from "vitest";
import { mailInput, type MailState } from "./mail-form-lesen.ts";
import { MAX_PEM_SIZE } from "./MailGraphFields.tsx";

const vorlagen = { "rechnung:de": { subject: "Rechnung {nummer}", body: "" } };

const zustand = (patch: Partial<MailState> = {}): MailState => ({
  transport: "smtp",
  graphAuth: "certificate",
  server: { host: "smtp.example.org", port: "587", secure: false },
  days: [7, 1],
  templates: vorlagen,
  ...patch,
});

/** Formular mit den Feldern, die beide Versandwege haben, und den übergebenen dazu */
function formular(felder: Record<string, string | File>) {
  const form = new FormData();
  const alle: Record<string, string | File> = {
    fromAddress: " rechnung@firma.de ",
    fromName: "",
    reminderTo: "ich@firma.de",
    remindersEnabled: "on",
    ...felder,
  };
  for (const [name, wert] of Object.entries(alle)) form.append(name, wert);
  return form;
}

const pemDatei = (inhalt: string, name = "datei.pem") => new File([inhalt], name, { type: "application/x-pem-file" });

describe("mailInput", () => {
  it("SMTP: Server aus dem Zustand, Port als Zahl, Texte ohne Leerzeichen am Rand, leeres Passwort bleibt unverändert", async () => {
    const daten = await mailInput(formular({ username: " max ", password: "  " }), zustand());
    expect(daten).toEqual({
      transport: "smtp",
      host: "smtp.example.org",
      port: 587,
      secure: false,
      username: "max",
      password: undefined,
      fromAddress: "rechnung@firma.de",
      fromName: "",
      reminderTo: "ich@firma.de",
      remindersEnabled: true,
      reminderDays: [7, 1],
      templates: vorlagen,
      pruefwertMail: false,
    });
  });

  it("SMTP: ein eingetragenes Passwort geht mit", async () => {
    const daten = await mailInput(formular({ username: "max", password: "geheim" }), zustand());
    expect(daten).toMatchObject({ password: "geheim" });
  });

  it("Microsoft 365 mit Secret: nimmt das Secret, keine Dateien", async () => {
    const felder = { graphTenantId: " firma.onmicrosoft.com ", graphClientId: "abc", graphMailbox: "rechnung@firma.de", clientSecret: " s3cr3t " };
    const daten = await mailInput(formular({ ...felder, pruefwertMail: "on" }), zustand({ transport: "graph", graphAuth: "secret" }));
    expect(daten).toEqual({
      transport: "graph",
      graphTenantId: "firma.onmicrosoft.com",
      graphClientId: "abc",
      graphAuth: "secret",
      graphMailbox: "rechnung@firma.de",
      clientSecret: "s3cr3t",
      certificatePem: undefined,
      privateKeyPem: undefined,
      fromAddress: "rechnung@firma.de",
      fromName: "",
      reminderTo: "ich@firma.de",
      remindersEnabled: true,
      reminderDays: [7, 1],
      templates: vorlagen,
      pruefwertMail: true,
    });
  });

  it("Microsoft 365 mit Secret: ein leeres Secret bleibt unverändert", async () => {
    const daten = await mailInput(formular({ clientSecret: "" }), zustand({ transport: "graph", graphAuth: "secret" }));
    expect(daten).toMatchObject({ clientSecret: undefined });
  });

  it("Microsoft 365 mit Zertifikat: liest Zertifikat und Schlüssel aus den Dateien, ein Secret im Feld zählt nicht", async () => {
    const felder = { certificate: pemDatei("-----BEGIN CERTIFICATE-----"), privateKey: pemDatei("-----BEGIN PRIVATE KEY-----"), clientSecret: "alt" };
    const daten = await mailInput(formular(felder), zustand({ transport: "graph", graphAuth: "certificate" }));
    expect(daten).toMatchObject({
      graphAuth: "certificate",
      clientSecret: undefined,
      certificatePem: "-----BEGIN CERTIFICATE-----",
      privateKeyPem: "-----BEGIN PRIVATE KEY-----",
    });
  });

  it("Microsoft 365 mit Zertifikat: ohne gewählte Datei bleiben Zertifikat und Schlüssel unverändert", async () => {
    const daten = await mailInput(formular({ certificate: pemDatei(""), privateKey: pemDatei("") }), zustand({ transport: "graph" }));
    expect(daten).toMatchObject({ certificatePem: undefined, privateKeyPem: undefined });
  });

  it("Microsoft 365 mit Zertifikat: lehnt eine Datei über der Grenze ab", async () => {
    const gross = pemDatei("x".repeat(MAX_PEM_SIZE + 1));
    await expect(mailInput(formular({ certificate: gross }), zustand({ transport: "graph" }))).rejects.toThrow(
      "Die Datei ist zu groß für ein Zertifikat oder einen Schlüssel.",
    );
  });
});
