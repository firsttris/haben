import { describe, expect, it } from "vitest";
import {
  cancellationProblem,
  documentOpen,
  invoiceEditProblem,
  invoiceListStatus,
  invoiceOpen,
  quoteDecisionProblem,
  quoteEditProblem,
  quoteInvoiceProblem,
  quoteStatus,
  stornoOpen,
  vatReturnCorrectionProblem,
  vatReturnSendProblem,
  type InvoiceFacts,
} from "./lebenszyklus.ts";

const rechnung = (over: Partial<InvoiceFacts> = {}): InvoiceFacts => ({ status: "final", kind: "rechnung", gross: 11_900, paid: 0, cancelled: false, ...over });
const today = "2026-05-15";

describe("offener Betrag einer Rechnung", () => {
  it.each([
    ["unbezahlt", rechnung(), 11_900],
    ["teilweise bezahlt", rechnung({ paid: 5_000 }), 6_900],
    ["bezahlt", rechnung({ paid: 11_900 }), 0],
    ["überzahlt: zu erstatten", rechnung({ paid: 12_000 }), -100],
    ["Entwurf ist nie offen", rechnung({ status: "draft" }), 0],
    ["storniert ist nie offen, auch wenn bezahlt", rechnung({ cancelled: true, paid: 5_000 }), 0],
    ["Korrektur: Gutschrift zu erstatten", rechnung({ kind: "korrektur", gross: -2_000 }), -2_000],
    ["Korrektur ausgezahlt", rechnung({ kind: "korrektur", gross: -2_000, paid: -2_000 }), 0],
    ["Storno einer unbezahlten Rechnung", rechnung({ kind: "storno", gross: -11_900, paidOnOriginal: 0 }), 0],
    ["Storno einer bezahlten Rechnung: Erstattung offen", rechnung({ kind: "storno", gross: -11_900, paidOnOriginal: 11_900 }), -11_900],
    ["Storno, Erstattung teilweise ausgezahlt", rechnung({ kind: "storno", gross: -11_900, paidOnOriginal: 11_900, paid: -4_000 }), -7_900],
    ["Storno, Erstattung ausgezahlt", rechnung({ kind: "storno", gross: -11_900, paidOnOriginal: 11_900, paid: -11_900 }), 0],
  ])("%s", (_, facts, open) => {
    expect(invoiceOpen(facts)).toBe(open);
  });

  it("stornoOpen hebt Rechnung und Storno gegeneinander auf", () => {
    expect(stornoOpen(0, 0)).toBe(0);
    expect(stornoOpen(500, 0)).toBe(-500);
    expect(stornoOpen(500, -500)).toBe(0);
  });
});

describe("Status in der Rechnungsliste", () => {
  it.each([
    ["Entwurf", rechnung({ status: "draft" }), "2026-06-01", "entwurf"],
    ["offen, nicht fällig", rechnung(), "2026-06-01", "offen"],
    ["teilbezahlt, nicht fällig", rechnung({ paid: 100 }), "2026-06-01", "teilbezahlt"],
    ["überfällig vor teilbezahlt", rechnung({ paid: 100 }), "2026-05-01", "ueberfaellig"],
    ["fällig heute ist noch nicht überfällig", rechnung(), today, "offen"],
    ["bezahlt, auch wenn überfällig", rechnung({ paid: 11_900 }), "2026-05-01", "bezahlt"],
    ["storniert", rechnung({ cancelled: true }), "2026-05-01", "storniert"],
    ["Stornorechnung", rechnung({ kind: "storno", gross: -11_900 }), today, "storno"],
    ["Korrektur offen", rechnung({ kind: "korrektur", gross: -2_000 }), today, "korrektur"],
    ["Korrektur ausgeglichen", rechnung({ kind: "korrektur", gross: -2_000, paid: -2_000 }), today, "korrektur"],
  ] as const)("%s", (_, facts, dueDate, status) => {
    expect(invoiceListStatus({ ...facts, dueDate }, today)).toBe(status);
  });
});

describe("Lebenszyklus einer Rechnung", () => {
  it("nur Entwürfe lassen sich ändern", () => {
    expect(invoiceEditProblem({ status: "draft" })).toBeNull();
    expect(invoiceEditProblem({ status: "final" })).toMatch(/festgeschrieben/);
  });

  it("Storno und Korrektur nur für festgeschriebene, nicht stornierte, nicht abgezogene Rechnungen", () => {
    const ok = { cancelled: false, deductedIn: null };
    expect(cancellationProblem({ status: "final", kind: "rechnung", number: "2026-001" }, ok)).toBeNull();
    expect(cancellationProblem({ status: "draft", kind: "rechnung", number: null }, ok)).toMatch(/Nur festgeschriebene/);
    expect(cancellationProblem({ status: "final", kind: "storno", number: "2026-002" }, ok)).toMatch(/Nur festgeschriebene/);
    expect(cancellationProblem({ status: "final", kind: "korrektur", number: "2026-003" }, ok)).toMatch(/Nur festgeschriebene/);
    expect(cancellationProblem({ status: "final", kind: "rechnung", number: "2026-001" }, { cancelled: true, deductedIn: null })).toBe(
      "Die Rechnung 2026-001 ist bereits storniert",
    );
    expect(cancellationProblem({ status: "final", kind: "rechnung", number: "2026-001" }, { cancelled: false, deductedIn: "2026-009" })).toMatch(
      /Schlussrechnung 2026-009 abgezogen/,
    );
  });
});

describe("offener Betrag eines Belegs", () => {
  it("Vorzeichen wie auf dem Konto", () => {
    expect(documentOpen(5_950, 0)).toBe(-5_950);
    expect(documentOpen(5_950, -2_000)).toBe(-3_950);
    expect(documentOpen(5_950, -5_950)).toBe(0);
    // Gutschrift des Lieferanten
    expect(documentOpen(-1_000, 0)).toBe(1_000);
    expect(documentOpen(-1_000, 1_000)).toBe(0);
  });
});

describe("Lebenszyklus eines Angebots", () => {
  const angebot = { status: "final" as const, decision: null, invoiceId: null, validUntil: "2026-05-31" };

  it.each([
    ["Entwurf", { ...angebot, status: "draft" as const }, "entwurf"],
    ["offen", angebot, "offen"],
    ["gültig bis heute ist noch offen", { ...angebot, validUntil: today }, "offen"],
    ["abgelaufen", { ...angebot, validUntil: "2026-05-14" }, "abgelaufen"],
    ["angenommen, auch nach Ablauf", { ...angebot, decision: "angenommen" as const, validUntil: "2026-01-01" }, "angenommen"],
    ["abgelehnt", { ...angebot, decision: "abgelehnt" as const }, "abgelehnt"],
    ["abgerechnet vor allem anderen", { ...angebot, decision: "angenommen" as const, invoiceId: "x" }, "abgerechnet"],
  ] as const)("%s", (_, facts, status) => {
    expect(quoteStatus(facts, today)).toBe(status);
  });

  it("Übergänge", () => {
    expect(quoteEditProblem({ status: "draft" })).toBeNull();
    expect(quoteEditProblem({ status: "final" })).toMatch(/festgeschrieben/);
    expect(quoteDecisionProblem(angebot)).toBeNull();
    expect(quoteDecisionProblem({ ...angebot, status: "draft" })).toMatch(/Entwurf/);
    expect(quoteDecisionProblem({ ...angebot, invoiceId: "x" })).toMatch(/bereits eine Rechnung/);
    expect(quoteInvoiceProblem(angebot)).toBeNull();
    expect(quoteInvoiceProblem({ ...angebot, decision: "angenommen" })).toBeNull();
    expect(quoteInvoiceProblem({ ...angebot, status: "draft" })).toMatch(/Nur festgeschriebene/);
    expect(quoteInvoiceProblem({ ...angebot, invoiceId: "x" })).toMatch(/bereits eine Rechnung/);
    expect(quoteInvoiceProblem({ ...angebot, decision: "abgelehnt" })).toMatch(/abgelehnt/);
  });
});

describe("Lebenszyklus einer Voranmeldung", () => {
  it("senden nur als Entwurf, berichtigen nur nach dem Senden", () => {
    expect(vatReturnSendProblem({ status: "draft" })).toBeNull();
    expect(vatReturnSendProblem({ status: "sent" })).toMatch(/bereits gesendet/);
    expect(vatReturnCorrectionProblem({ status: "sent" })).toBeNull();
    expect(vatReturnCorrectionProblem({ status: "draft" })).toMatch(/keine gesendete/);
    expect(vatReturnCorrectionProblem(undefined)).toMatch(/keine gesendete/);
  });
});
