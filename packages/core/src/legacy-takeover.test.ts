import { describe, expect, it } from "vitest";
import { legacyOpenAt, takeoverCutoff, takeoverCutoffIssue, type LegacyOpenVoucher } from "./legacy-takeover.ts";

const invoice = (payment: LegacyOpenVoucher["payment"], status = "open"): LegacyOpenVoucher => ({ gross: 119_000, status, payment });
const paid = (date: string, amount: number, type = "partPaymentFinancialTransaction") => ({ type, date, amount });

describe("legacyOpenAt: offen am Stichtag", () => {
  it("ohne Zahlungen ist der ganze Betrag offen", () => {
    expect(legacyOpenAt(invoice({ openAmount: 119_000, items: [] }), "2025-12-31")).toEqual({
      open: 119_000,
      paidAfter: 0,
      issue: null,
    });
  });

  it("im Januar bezahlt: am 31.12. ganz offen, die Zahlung kommt in Haben an", () => {
    const voucher = invoice({ openAmount: 0, items: [paid("2026-01-15", 119_000)] }, "paid");
    expect(legacyOpenAt(voucher, "2025-12-31")).toEqual({ open: 119_000, paidAfter: 119_000, issue: null });
  });

  it("im Dezember bezahlt: am Stichtag nicht offen", () => {
    const voucher = invoice({ openAmount: 0, items: [paid("2025-12-20", 119_000)] }, "paid");
    expect(legacyOpenAt(voucher, "2025-12-31").open).toBe(0);
  });

  it("am Stichtag selbst bezahlt zählt als bezahlt", () => {
    const voucher = invoice({ openAmount: 0, items: [paid("2025-12-31", 119_000)] }, "paid");
    expect(legacyOpenAt(voucher, "2025-12-31").open).toBe(0);
  });

  it("Teilzahlung vor dem Stichtag mindert den offenen Betrag, eine danach nicht", () => {
    const voucher = invoice({
      openAmount: 19_000,
      items: [paid("2025-11-30", 50_000), paid("2026-01-10", 50_000, "manualPayment")],
    });
    expect(legacyOpenAt(voucher, "2025-12-31")).toEqual({ open: 69_000, paidAfter: 50_000, issue: null });
  });

  it("Ausgabebelege: Beträge mit negativem Vorzeichen", () => {
    const voucher: LegacyOpenVoucher = {
      gross: 11_900,
      status: "paid",
      payment: { openAmount: 0, items: [paid("2026-01-05", -11_900)] },
    };
    expect(legacyOpenAt(voucher, "2025-12-31")).toEqual({ open: 11_900, paidAfter: 11_900, issue: null });
  });

  it("Skonto und Forderungsausfall nach dem Stichtag gehören in Haben; am Stichtag war der Betrag offen", () => {
    const voucher = invoice(
      {
        openAmount: 0,
        items: [paid("2026-01-15", 116_620), paid("2026-01-15", 2_380, "cashDiscount")],
      },
      "paid",
    );
    expect(legacyOpenAt(voucher, "2025-12-31")).toEqual({ open: 119_000, paidAfter: 116_620, issue: null });
  });

  it("unbekannte Zahlungsart oder Zahlung ohne Datum nach dem Stichtag: Stand unklar", () => {
    const unknown = invoice({ openAmount: 0, items: [paid("2026-01-15", 119_000, "somethingNew")] }, "paid");
    expect(legacyOpenAt(unknown, "2025-12-31").issue).toMatch(/somethingNew/);
    const undated = invoice({ openAmount: 0, items: [paid("", 119_000)] }, "paid");
    expect(legacyOpenAt(undated, "2025-12-31").issue).toMatch(/ohne Datum/);
  });

  it("Zahlungen über dem Betrag: Stand unklar", () => {
    const voucher = invoice({ openAmount: 119_000, items: [paid("2026-01-15", 10_000)] });
    expect(legacyOpenAt(voucher, "2025-12-31").issue).toMatch(/passen nicht/);
  });

  it("ohne Zahlungsdaten entscheidet der Status wie bisher", () => {
    expect(legacyOpenAt(invoice(null, "overdue"), "2025-12-31").open).toBe(119_000);
    expect(legacyOpenAt(invoice(null, "paid"), "2025-12-31").open).toBe(0);
  });
});

describe("takeoverCutoff: Stichtag der Übernahme", () => {
  const base = { rechtsform: "einzelunternehmen" as const, openingDate: null, stapelYear: null, lastVoucherDate: "2025-11-30", today: "2026-02-10" };

  it("Einzelunternehmen: 31.12. des letzten Jahres der alten Buchhaltung, gebucht zum 1.1.", () => {
    expect(takeoverCutoff(base)).toEqual({ date: "2025-12-31", bookingDate: "2026-01-01", fixed: null });
  });

  it("alte Buchhaltung läuft ins laufende Jahr: Tag vor heute", () => {
    expect(takeoverCutoff({ ...base, lastVoucherDate: "2026-01-20" })).toEqual({ date: "2026-02-09", bookingDate: "2026-02-10", fixed: null });
  });

  it("der DATEV-Stapel zählt zum letzten Jahr der alten Buchhaltung", () => {
    expect(takeoverCutoff({ ...base, lastVoucherDate: "2024-10-01", stapelYear: 2025 }).date).toBe("2025-12-31");
  });

  it("ohne Daten: 31.12. des Vorjahres", () => {
    expect(takeoverCutoff({ ...base, lastVoucherDate: null }).date).toBe("2025-12-31");
  });

  it("ein gewählter Stichtag gilt, solange nichts ihn festlegt", () => {
    expect(takeoverCutoff({ ...base, requested: "2026-01-31" })).toEqual({ date: "2026-01-31", bookingDate: "2026-02-01", fixed: null });
  });

  it("mit gebuchter Eröffnung beginnen die Bücher dort; der Stichtag ist der Tag davor", () => {
    const cutoff = takeoverCutoff({ ...base, rechtsform: "gmbh", openingDate: "2026-01-01", requested: "2026-01-31" });
    expect(cutoff).toEqual({ date: "2025-12-31", bookingDate: "2026-01-01", fixed: expect.stringMatching(/Eröffnung/) });
  });

  it("GmbH mit DATEV-Stapel: Ende des Stapeljahres, wie die Eröffnung aus dem Stapel", () => {
    const cutoff = takeoverCutoff({ ...base, rechtsform: "ug", stapelYear: 2025, lastVoucherDate: "2026-01-20" });
    expect(cutoff).toEqual({ date: "2025-12-31", bookingDate: "2026-01-01", fixed: expect.stringMatching(/DATEV-Stapel/) });
  });

  it("GmbH ohne Stapel: immer ein 31.12., auch wenn die alte Buchhaltung ins laufende Jahr reicht", () => {
    expect(takeoverCutoff({ ...base, rechtsform: "gmbh", lastVoucherDate: "2026-01-20" }).date).toBe("2025-12-31");
  });
});

describe("takeoverCutoffIssue", () => {
  it("der Stichtag liegt vor heute", () => {
    expect(takeoverCutoffIssue("2026-02-10", "einzelunternehmen", "2026-02-10")).toMatch(/vor heute/);
    expect(takeoverCutoffIssue("2026-02-09", "einzelunternehmen", "2026-02-10")).toBeNull();
  });

  it("GmbH und UG: der Stichtag ist ein 31.12., weil die Eröffnung am 1.1. steht", () => {
    expect(takeoverCutoffIssue("2025-11-30", "gmbh", "2026-02-10")).toMatch(/31\. Dezember/);
    expect(takeoverCutoffIssue("2025-12-31", "ug", "2026-02-10")).toBeNull();
  });

  it("kein gültiges Datum", () => {
    expect(takeoverCutoffIssue("2025-02-30", "einzelunternehmen", "2026-02-10")).toMatch(/Datum/);
  });
});
