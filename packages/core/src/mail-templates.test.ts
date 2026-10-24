import { describe, expect, it } from "vitest";
import { DEFAULT_MAIL_TEMPLATES, invoiceTemplateKind, mailTemplateFallback, resolveMailTemplate } from "./mail-templates.ts";

describe("resolveMailTemplate", () => {
  it("eigene Vorlage der Art, sonst die allgemeine derselben Sprache, sonst der Standardtext; Betreff und Text einzeln", () => {
    const templates = {
      "rechnung:de": { subject: "R {nummer}", body: "Allgemein" },
      "schluss:de": { subject: "S {nummer}", body: "" },
      "rechnung:en": { subject: "", body: "General" },
    };
    expect(resolveMailTemplate(templates, "schluss", "de")).toEqual({ subject: "S {nummer}", body: "Allgemein" });
    expect(resolveMailTemplate(templates, "storno", "de")).toEqual({ subject: "R {nummer}", body: "Allgemein" });
    // Die deutsche Vorlage gilt nicht für Englisch
    expect(resolveMailTemplate(templates, "storno", "en")).toEqual({ subject: DEFAULT_MAIL_TEMPLATES.rechnung.en!.subject, body: "General" });
    expect(resolveMailTemplate({}, "angebot", "en")).toEqual(DEFAULT_MAIL_TEMPLATES.angebot.en);
    // Nur Leerzeichen zählt als leer
    expect(resolveMailTemplate({ "angebot:de": { subject: "  ", body: "" } }, "angebot", "de")).toEqual(DEFAULT_MAIL_TEMPLATES.angebot.de);
  });

  it("Mahnungen nur auf Deutsch: Stufe, dann allgemeine Mahnung", () => {
    const templates = { "mahnung:de": { subject: "{stufe}", body: "Text" } };
    expect(resolveMailTemplate(templates, "mahnung-2", "en")).toEqual({ subject: "{stufe}", body: "Text" });
    expect(resolveMailTemplate(null, "mahnung-1", "de")).toEqual(DEFAULT_MAIL_TEMPLATES.mahnung.de);
  });

  it("Hinweis zum Rückfall und Art einer Rechnung", () => {
    expect(mailTemplateFallback({ "rechnung:en": { subject: "Inv", body: "" } }, "abschlag", "en", "subject")).toEqual({ text: "Inv", source: { kind: "rechnung" } });
    expect(mailTemplateFallback({ "rechnung:en": { subject: "Inv", body: "" } }, "abschlag", "en", "body").source).toBe("standard");
    expect(mailTemplateFallback({}, "rechnung", "de", "subject")).toEqual({ text: DEFAULT_MAIL_TEMPLATES.rechnung.de!.subject, source: "standard" });
    expect(invoiceTemplateKind({ kind: "rechnung", variant: null })).toBe("rechnung");
    expect(invoiceTemplateKind({ kind: "rechnung", variant: "schluss" })).toBe("schluss");
    expect(invoiceTemplateKind({ kind: "korrektur", variant: null })).toBe("korrektur");
  });
});
