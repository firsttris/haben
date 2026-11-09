import { describe, expect, it } from "vitest";
import { customFooter,
  customFooterRuns, DEFAULT_FOOTER_COLUMNS, fillFooterColumn, footerIssues, footerValues, MAX_FOOTER_LINES } from "./footer-template.ts";

const seller = {
  name: "Testfirma",
  strasse: "Musterstraße 1",
  plz: "93047",
  ort: "Regensburg",
  email: "rechnung@example.com",
  iban: "DE89370400440532013000",
  steuernummer: "198/113/10010",
};
const values = footerValues(seller);

describe("Eigene Fußzeile", () => {
  it("setzt Werte ein und lässt Text stehen", () => {
    expect(fillFooterColumn("{firma}\n{plz} {ort}\nGeprüft", values)).toEqual(["Testfirma", "93047 Regensburg", "Geprüft"]);
  });

  it("lässt eine Zeile weg, wenn ihr Wert fehlt", () => {
    expect(fillFooterColumn("Telefon {telefon}\nBIC {bic}\n{email}", values)).toEqual(["rechnung@example.com"]);
  });

  it("der Kontoinhaber ist ohne eigene Angabe die Firma", () => {
    expect(values.kontoinhaber).toBe("Testfirma");
  });

  it("die Vorgabe hat nur bekannte Platzhalter", () => {
    expect(footerIssues(DEFAULT_FOOTER_COLUMNS)).toEqual([]);
  });

  it("meldet unbekannte Platzhalter und zu viele Zeilen", () => {
    expect(footerIssues(["{fax}", "{firma}"]).join(" ")).toContain("{fax}");
    expect(footerIssues(["x\n".repeat(MAX_FOOTER_LINES).concat("y"), "{ustid}"])).toHaveLength(1);
  });

  it("verlangt Steuernummer oder USt-IdNr. in den Spalten (§ 14 Abs. 4 Nr. 2 UStG)", () => {
    expect(footerIssues(["{firma}", "{iban}"]).join(" ")).toContain("Steuernummer oder USt-IdNr.");
    expect(footerIssues(["{firma}", "{steuernummer}"])).toEqual([]);
    expect(footerIssues(["{firma}", "{ustid}"])).toEqual([]);
  });

  it("setzt die Spalten ein, ohne etwas zu ergänzen", () => {
    expect(customFooter(["{firma}", "{iban}"], values)).toEqual([["Testfirma"], ["DE89370400440532013000"]]);
  });
});

describe("Auszeichnungen in eigenen Spalten", () => {
  const plain = { bold: false, italic: false, underline: false };

  it("liest fett, kursiv und unterstrichen, auch um Platzhalter", () => {
    expect(customFooterRuns(["*{firma}*\n_Hinweis_\n__Wichtig__"], values)).toEqual([
      [
        [{ text: "Testfirma", ...plain, bold: true }],
        [{ text: "Hinweis", ...plain, italic: true }],
        [{ text: "Wichtig", ...plain, underline: true }],
      ],
    ]);
  });

  it("wertet Zeichen aus den Firmendaten nicht als Auszeichnung", () => {
    const eigen = { ...values, email: "_info_@beispiel.de", firma: "*Stern* GmbH" };
    expect(customFooterRuns(["{email}\n{firma}"], eigen)).toEqual([[[{ text: "_info_@beispiel.de", ...plain }], [{ text: "*Stern* GmbH", ...plain }]]]);
  });

  it("nennt als Text nur den Inhalt, ohne die Zeichen", () => {
    expect(customFooter(["*{firma}*", "_Hinweis_"], values)).toEqual([["Testfirma"], ["Hinweis"]]);
  });

  it("lässt eine Zeile weg, wenn der Platzhalter darin leer ist, auch ausgezeichnet", () => {
    expect(customFooterRuns(["*{telefon}*"], { ...values, telefon: "" })).toEqual([[]]);
  });

  it("ergänzt die fehlende Steuerkennung als normalen Text", () => {
    const runs = customFooterRuns(["{firma}", "*{steuernummer}*"], { ...values, steuernummer: "", ustid: "DE123456789" });
    expect(runs[1]).toEqual([[{ text: "USt-IdNr. DE123456789", ...plain }]]);
  });
});
