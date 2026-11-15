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
    bankTransactions: { hits: [], more: false },
    bookings: { hits: [], more: false },
    accounts: { hits: [], more: false },
    recurringInvoices: { hits: [], more: false },
    recurringDocuments: { hits: [], more: false },
    articles: { hits: [], more: false },
    textBlocks: { hits: [], more: false },
    serviceEntries: { hits: [], more: false },
    assets: { hits: [], more: false },
    loans: { hits: [], more: false },
    cashEntries: { hits: [], more: false },
    pauschalen: { hits: [], more: false },
    employees: { hits: [], more: false },
    vatReturns: { hits: [], more: false },
    zmSubmissions: { hits: [], more: false },
    postfachDocuments: { hits: [], more: false },
    archive: { hits: [], more: false },
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

  it("öffnet einen Bankumsatz im Konto, zu dem er gehört, nicht im ersten Konto", () => {
    const umsatz = {
      id: "11111111-1111-4111-8111-111111111111",
      bankAccountId: "22222222-2222-4222-8222-222222222222",
      bookingDate: "2026-11-14",
      amount: -123456,
      currency: "EUR",
      counterpartyName: "Cloud Hosting GmbH",
      purpose: "Rechnung 42",
      accountName: "Zweitkonto",
      hint: "belegFehlt" as const,
      open: -123456,
      ibanLast4: "9900",
    };
    const sections = buildRemoteSections({ ...sampleResult, bankTransactions: { hits: [umsatz], more: false } }, true);
    const item = sections.find((s) => s.id === "bank")?.items[0];
    expect(item).toMatchObject({ to: "/bank", search: { konto: umsatz.bankAccountId, umsatz: umsatz.id, filter: "alle" } });
  });

  it("zeigt Art, Geber und Übermittlung mit ihren Bezeichnungen statt der gespeicherten Schlüssel", () => {
    const sections = buildRemoteSections(
      {
        ...sampleResult,
        loans: { hits: [{ id: "l1", name: "Kredit", lender: "bank", openingBalance: 0, balance: 4800000, openingDate: null }], more: false },
        pauschalen: { hits: [{ id: "p1", art: "fahrt", date: "2026-09-15", description: "Kundentermin", amount: 3600, storniert: false }], more: false },
        employees: { hits: [{ id: "e1", personalnummer: 7, vorname: "Berta", nachname: "Muster", art: "beschaeftigt" }], more: false },
        zmSubmissions: {
          hits: [{ id: "z1", year: 2026, month: 41, kind: "send", ok: true, code: 0, createdAt: new Date("2026-04-10") }],
          more: false,
        },
      },
      true,
    );
    const meta = (id: string) => sections.flatMap((s) => s.items).find((item) => item.id === id)?.meta;
    expect(meta("loan-l1")).toBe("Kreditinstitut");
    expect(meta("pauschale-p1")).toBe("Fahrten mit dem Privatfahrzeug · 15.09.2026");
    expect(meta("employee-e1")).toBe("Personalnr. 7 · Sozialversicherungspflichtig beschäftigt");
    expect(meta("zm-z1")).toBe("Übermittlung");
  });

  it("gibt den Treffern aus Stufe 2 ihren Zustand für die Status-Komponente ihrer Seite", () => {
    const umsatz = (id: string, konto: string) => ({
      id,
      bankAccountId: konto,
      bookingDate: "2026-10-01",
      amount: -250000,
      currency: "EUR",
      counterpartyName: "Bank",
      purpose: "Rate",
      accountName: "Konto",
      hint: "teilweise" as const,
      open: -50000,
      ibanLast4: null,
    });
    const einKonto = buildRemoteSections({ ...sampleResult, bankTransactions: { hits: [umsatz("a", "k1"), umsatz("b", "k1")], more: true } }, true);
    const bank = einKonto.find((s) => s.id === "bank");
    expect(bank?.items[0]).toMatchObject({ status: { kind: "bank", tx: { hint: "teilweise", open: -50000 } } });
    expect(bank).toMatchObject({ to: "/bank", moreSearch: { konto: "k1", filter: "alle" } });
    // Zwei Konten: die Bankseite sucht je Konto, deshalb kein „Alle anzeigen“
    const zweiKonten = buildRemoteSections({ ...sampleResult, bankTransactions: { hits: [umsatz("a", "k1"), umsatz("b", "k2")], more: false } }, true);
    expect(zweiKonten.find((s) => s.id === "bank")?.to).toBeUndefined();

    const vat = { id: "v1", year: 2026, month: 41, status: "draft" as const, sentAt: null, berichtigt: false, filedOn: null, dueDate: "2026-05-11" };
    const sections = buildRemoteSections(
      {
        ...sampleResult,
        vatReturns: { hits: [vat], more: false },
        zmSubmissions: { hits: [{ id: "z1", year: 2026, month: 41, kind: "send", ok: false, code: 610001, createdAt: new Date("2026-04-10") }], more: false },
        recurringInvoices: {
          hits: [{ id: "r1", name: "Wartung", customer: "Kunde", intervalMonths: 1, nextDate: "2026-12-01", active: false, lastError: "kaputt" }],
          more: false,
        },
        recurringDocuments: {
          hits: [{ id: "d1", name: "Miete", supplierName: "Vermieter", intervalMonths: 1, nextDate: "2026-12-01", status: "pausiert", lastError: null }],
          more: false,
        },
        pauschalen: { hits: [{ id: "p1", art: "fahrt", date: "2026-09-15", description: "Termin", amount: 3600, storniert: true }], more: false },
      },
      true,
    );
    const status = (id: string) => sections.flatMap((s) => s.items).find((item) => item.id === id);
    expect(status("vat-v1")).toMatchObject({ status: { kind: "vat", vat }, params: { zeitraum: "2026-Q1" } });
    expect(status("zm-z1")).toMatchObject({ status: { kind: "zm", ok: false, code: 610001 }, params: { quartal: "2026-Q1" } });
    expect(status("rec-inv-r1")).toMatchObject({ status: { kind: "recurringInvoice", active: false, lastError: "kaputt" } });
    expect(status("rec-doc-d1")).toMatchObject({ status: { kind: "recurringDocument", status: "pausiert", lastError: null } });
    expect(status("pauschale-p1")).toMatchObject({ status: { kind: "pauschale", storniert: true } });
  });

  it("formuliert die Statusmeldung für Screenreader im Singular und Plural", () => {
    expect(statusMessage(true, 3, 0)).toBe("Suche läuft …");
    expect(statusMessage(false, 2, 0)).toBe("Keine Treffer gefunden.");
    expect(statusMessage(false, 2, 1)).toBe("1 Treffer.");
    expect(statusMessage(false, 2, 4)).toBe("4 Treffer.");
  });
});
