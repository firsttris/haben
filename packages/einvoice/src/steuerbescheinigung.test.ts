import { ausschuettungAnteil, steuerbescheinigung, type Steuerbescheinigung } from "@haben/core";
import { describe, expect, it } from "vitest";
import { buildSteuerbescheinigungPdf, steuerbescheinigungPdfData } from "./steuerbescheinigung.ts";

function bescheinigung(kirchensteuer: 0 | 9, geschaeftsjahr: number | null = 2025): Steuerbescheinigung {
  const anteil = ausschuettungAnteil({ brutto: 1_000_000, ausEinlagekonto: 200_000, kirchensteuer });
  const r = steuerbescheinigung({
    aussteller: { name: "Nordlicht Software GmbH", strasse: "Hafenallee 3", plz: "28217", ort: "Bremen", steuernummer: "60/145/12345" },
    glaeubiger: { name: "Erika Muster", strasse: "Lindenweg 1", plzOrt: "28195 Bremen", idnr: "86095742719", religionsgemeinschaft: "römisch-katholisch" },
    anteil: { ...anteil, religionsschluessel: kirchensteuer ? "026300" : null },
    beschluss: { datum: "2026-04-28", geschaeftsjahr },
    zahlungstag: "2026-05-05",
    ausstellungstag: "2026-05-06",
  });
  if (!r.ok) throw new Error(r.fehlend.join(" "));
  return r.bescheinigung;
}

describe("Steuerbescheinigung als PDF (Muster II)", () => {
  it("Titel und Art der Bescheinigung im Wortlaut des Musters", () => {
    const data = steuerbescheinigungPdfData({ bescheinigung: bescheinigung(0) });
    expect(data.title).toBe("Steuerbescheinigung");
    expect(data.subtitle).toBe(
      "einer leistenden Körperschaft, Personenvereinigung oder Vermögensmasse oder eines Personenunternehmens oder eines Spezial-Investmentfonds oder eines inländischen Betreibers/einer inländischen Zweigniederlassung eines ausländischen Betreibers einer Internet-Dienstleistungsplattform",
    );
    expect(data.kind).toBe("☒ Einzelsteuerbescheinigung");
  });

  it("Schuldner vor dem Titel, Gläubiger, Beschluss, Zahlungstag und Zeitraum im Satz der Alternative 1", () => {
    const data = steuerbescheinigungPdfData({ bescheinigung: bescheinigung(0) });
    expect(data.recipient).toEqual(["Erika Muster", "Lindenweg 1", "28195 Bremen"]);
    expect(data.meta).toEqual([
      { label: "Schuldner der Kapitalerträge", value: "Nordlicht Software GmbH, Hafenallee 3, 28217 Bremen" },
      { label: "Steuernummer", value: "60/145/12345" },
      { label: "Datum", value: "06.05.2026" },
    ]);
    expect(data.intro).toBe(
      "An Erika Muster, Lindenweg 1, 28195 Bremen (Identifikationsnummer 86095742719) wurden lt. Beschluss vom 28.04.2026 am 05.05.2026 für das Geschäftsjahr 2025 folgende Kapitalerträge gezahlt:",
    );
    expect(steuerbescheinigungPdfData({ bescheinigung: bescheinigung(0, null) }).intro).toContain("am 05.05.2026 folgende Kapitalerträge gezahlt:");
  });

  it("Zeilen formatiert, Fußnoten des Musters zur Anlage KAP, keine eigenen Hinweise", () => {
    const data = steuerbescheinigungPdfData({ bescheinigung: bescheinigung(0) });
    expect(data.rows[0]).toEqual({ label: "Kapitalerträge im Sinne des § 43 Abs. 1 Satz 1 Nr. 1 EStG", value: "8.000,00\u00a0€" });
    expect(data.rows.map((r) => r.label)).toContain("Summe Solidaritätszuschlag¹");
    expect(data.rows.at(-1)).toEqual({ label: "Leistungen aus dem steuerlichen Einlagekonto (§ 27 Abs. 1 – 7 KStG)", value: "2.000,00\u00a0€" });
    expect(data.notes).toEqual(["¹ Bei Verwendung der Anlage KAP: Eintragung in Zeile 40.", "² Bei Verwendung der Anlage KAP: Eintragung in Zeile 41."]);
  });

  it("mit Kirchensteuer die Religionsgemeinschaft als Zeile unter der Kirchensteuer", () => {
    const rows = steuerbescheinigungPdfData({ bescheinigung: bescheinigung(9) }).rows;
    const kist = rows.findIndex((r) => r.label === "Summe Kirchensteuer zur Kapitalertragsteuer²");
    expect(rows[kist + 1]).toEqual({ label: "kirchensteuererhebende Religionsgemeinschaft", value: "römisch-katholisch" });
  });

  it("erzeugt ein PDF/A-3b", () => {
    const pdf = buildSteuerbescheinigungPdf({ bescheinigung: bescheinigung(9) });
    const text = Buffer.from(pdf).toString("latin1");
    expect(text.slice(0, 5)).toBe("%PDF-");
    expect(text).toContain("<pdfaid:part>3</pdfaid:part>");
  });
});
