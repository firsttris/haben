import { type OutgoingTaxDetails, section4Note } from "@haben/core";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OutgoingTaxFields } from "./OutgoingTaxFields.tsx";

const details: OutgoingTaxDetails = { exemption: null, ancillary: null, foreignPlace: null, assetDisposal: false };

function render(overrides: Partial<ComponentProps<typeof OutgoingTaxFields>> = {}) {
  return renderToStaticMarkup(
    createElement(OutgoingTaxFields, {
      treatment: "kleinunternehmer",
      details: null,
      exemptionReason: "",
      kleinunternehmer: true,
      onTreatmentChange: () => {},
      onDetailsChange: () => {},
      onReasonChange: () => {},
      ...overrides,
    }),
  );
}

function treatmentSelect(html: string) {
  return /<select\b[^>]*>(.*?)<\/select>/.exec(html)?.[0] ?? "";
}

describe("Gemeinsame Steuerfelder der Ausgangsbelege", () => {
  it("lässt Kleinunternehmer § 19, eigene Befreiungen und geklärte Auslandsfälle wählen", () => {
    const select = treatmentSelect(render());
    for (const value of ["kleinunternehmer", "steuerfrei", "reverse_charge", "drittland", "eu_sonstige"]) {
      expect(select).toContain(`value="${value}"`);
    }
    for (const value of ["regulaer", "ig_lieferung", "ausfuhr"]) expect(select).not.toContain(`value="${value}"`);
    expect(select).not.toContain("disabled");
  });

  it("hält eine unzulässige bisherige Behandlung sichtbar, gibt sie aber nicht neu frei", () => {
    const html = render({ treatment: "ig_lieferung" });
    expect(treatmentSelect(html)).toMatch(/<option value="ig_lieferung" disabled="" selected="">/);
    expect(html).toContain("Als Kleinunternehmer bitte § 19");
  });

  it("bietet ohne Kleinunternehmerstatus die regulären Behandlungen und keine neue §-19-Auswahl an", () => {
    const select = treatmentSelect(render({ treatment: "regulaer", kleinunternehmer: false }));
    for (const value of ["regulaer", "steuerfrei", "reverse_charge", "drittland", "eu_sonstige", "ig_lieferung", "ausfuhr"]) {
      expect(select).toContain(`value="${value}"`);
    }
    expect(select).not.toContain('value="kleinunternehmer"');
  });

  it.each([{ number: "14", letter: "a" }, { number: "21" }])("zeigt die ausdrücklich gewählte Vorschrift %j als festen Belegtext", (exemption) => {
    const html = render({ treatment: "steuerfrei", details: { ...details, exemption }, exemptionReason: "Alter Text" });
    expect(html).toContain(`value="${section4Note(exemption)}"`);
    expect(html).toContain('readonly=""');
    expect(html).not.toContain('value="Alter Text"');
    expect(html).not.toContain("Vorschrift ungeklärt");
    expect(html).not.toContain('class="field-error"');
  });

  it("deutet selbst einen passenden alten Freitext nicht in eine Vorschrift um", () => {
    const oldText = "Steuerfrei nach § 4 Nr. 14 Buchst. a UStG";
    const html = render({ treatment: "steuerfrei", exemptionReason: oldText });
    expect(html).toContain(`value="${oldText}"`);
    expect(html).toContain('<option value="" selected="">Nicht zugeordnet (ungeklärt)</option>');
    expect(html).toContain("Gesamtumsatz: Vorschrift ungeklärt");
    expect(html).toContain("alter Freitext bleibt ungeklärt");
  });

  it("zeigt EU-Privatleistungen getrennt von Reverse Charge und verlangt eine ausdrückliche Bestätigung", () => {
    const html = render({ treatment: "eu_sonstige" });
    expect(html).toContain("auch an Privatkunden");
    expect(html).toContain("Kein B2B-Reverse-Charge");
    expect(html).toMatch(/<input[^>]*value=""[^>]*pattern="\[A-Z\]\{2\}"[^>]*required=""/);
    expect(html).toContain("Kundenanschrift allein genügt nicht");
    expect(html).toContain('class="field-error"');
  });

  it.each(["eu_sonstige", "reverse_charge", "drittland"] as const)("übernimmt bei %s den festgestellten Ort und die gesonderte Bestätigung", (treatment) => {
    const html = render({ treatment, details: { ...details, foreignPlace: { country: treatment === "drittland" ? "CH" : "AT", noForeignVat: true } } });
    expect(html).toContain('<option value="bestaetigt" selected="">');
    expect(html).not.toContain('class="field-error"');
  });

  it("hält einen erfassten EU-Ort ohne bestätigte ausländische Behandlung gesperrt", () => {
    const html = render({ treatment: "eu_sonstige", details: { ...details, foreignPlace: { country: "AT", noForeignVat: false } } });
    expect(html).toContain('value="AT"');
    expect(html).toContain('class="field-error"');
    expect(html).toContain("ohne auszuweisende ausländische Umsatzsteuer bestätigen");
  });

  it("zeigt ausdrücklich gespeicherte Angaben für Anlageverkauf und Hilfsumsatz", () => {
    const html = render({
      treatment: "steuerfrei",
      kleinunternehmer: false,
      details: { ...details, exemption: { number: "8", letter: "a" }, ancillary: false, assetDisposal: true },
    });
    expect(html).toContain("Bisherige Vorschrift: § 4 Nr. 8 Buchst. a UStG");
    expect(html).toContain('<option value="ja" selected="">Ja, Verkauf eines Wirtschaftsguts des Anlagevermögens</option>');
    expect(html).toContain('<option value="nein" selected="">Nein</option>');
  });

  it("sperrt übernommene Steuerangaben einer Rechnungskorrektur vollständig", () => {
    const html = render({ treatment: "steuerfrei", exemptionReason: "Bisheriger Belegtext", disabled: true });
    const selects = html.match(/<select\b[^>]*>/g) ?? [];
    expect(selects.length).toBeGreaterThan(0);
    expect(selects.every((select) => select.includes('disabled=""'))).toBe(true);
    expect(html).toContain('readonly=""');
    expect(html).toContain('value="Bisheriger Belegtext"');
  });
});
