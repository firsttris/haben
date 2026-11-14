import { describe, expect, it } from "vitest";
import { buildPageSection, buildRemoteSections, statusMessage } from "./befehlspalette.ts";
import { sichtbareNavSeiten } from "./navigation.ts";

describe("Befehlspalette-Ergebnisse (#617)", () => {
  const seiten = sichtbareNavSeiten({
    inhaber: true,
    gesellschaft: false,
    hatMitarbeiter: true,
    eigeneSeiten: [],
  });

  const sampleResult = {
    contacts: {
      hits: [{ id: "c1", name: "Bergblick Software GmbH", kundennummer: "10001", lieferantennummer: "", ort: "München", isCustomer: true, isSupplier: false }],
      more: false,
    },
    invoices: {
      hits: [
        {
          id: "i1",
          number: "RE-2026-004",
          customer: "Bergblick Software GmbH",
          gross: 17850,
          status: "final" as const,
          kind: "rechnung" as const,
          issueDate: "2026-10-05",
          listStatus: "offen" as const,
          dunning: null,
          dueDate: "2026-10-19",
          paid: 0,
          open: 17850,
          settledOn: null,
          cancelledBy: null,
          correctsNumber: null,
        },
      ],
      more: false,
    },
    quotes: {
      hits: [
        {
          id: "q1",
          number: "AN-2026-002",
          customer: "Bergblick Software GmbH",
          gross: 9500,
          listStatus: "offen" as const,
          issueDate: "2026-10-05",
          validUntil: "2026-10-31",
          invoiceNumber: null,
        },
      ],
      more: false,
    },
    documents: {
      hits: [
        {
          id: "d1",
          supplierName: "Bergblick Cloud AG",
          invoiceNumber: "BLG-99",
          filename: "beleg.pdf",
          documentDate: "2026-10-04",
          gross: 4590,
          currency: "EUR",
          status: "gebucht" as const,
          extractionStatus: "fertig" as const,
          cancelled: false,
          cancelledOn: null,
          lockedAt: new Date("2026-10-04"),
          uploadedAt: new Date("2026-10-04"),
        },
      ],
      more: false,
    },
  };

  it("filtert Seiten nach Suchbegriff und begrenzt ohne Suchbegriff auf 5", () => {
    expect(buildPageSection(seiten, "")?.items).toHaveLength(5);
    expect(buildPageSection(seiten, "")?.items[0]).toMatchObject({ title: "Übersicht", meta: "" });
    const rechnungen = buildPageSection(seiten, "Rech");
    expect(rechnungen?.items.some((item) => item.title === "Rechnungen")).toBe(true);
    expect(buildPageSection(seiten, "zzzz-nicht-vorhanden")).toBeNull();
  });

  it("baut für Inhaber alle vier Gruppen jeweils mit Link zur gefilterten Liste", () => {
    const sections = buildRemoteSections(sampleResult, true);
    expect(sections.map((s) => s.label)).toEqual(["Kontakte", "Rechnungen", "Angebote", "Belege"]);
    expect(sections[0]?.to).toBe("/kontakte");
    expect(sections[1]?.to).toBe("/rechnungen");
    expect(sections[2]?.to).toBe("/angebote");
    expect(sections[3]?.to).toBe("/belege");
  });

  it("blendet für die Steuerberatung Kontakte und Angebote aus", () => {
    const sections = buildRemoteSections(sampleResult, false);
    expect(sections.map((s) => s.label)).toEqual(["Rechnungen", "Belege"]);
  });

  it("formuliert die Statusmeldung für Screenreader im Singular und Plural", () => {
    expect(statusMessage(true, 3, 0)).toBe("Suche läuft …");
    expect(statusMessage(false, 2, 0)).toBe("Keine Treffer gefunden.");
    expect(statusMessage(false, 2, 1)).toBe("1 Treffer.");
    expect(statusMessage(false, 2, 4)).toBe("4 Treffer.");
  });
});
