import { describe, expect, it } from "vitest";
import { advanceReceivables, type DeferredInvoice, type DeferredSettlement } from "./advance-receivables.ts";

const advance: DeferredInvoice = {
  id: "a",
  correctsId: null,
  replacesInvoiceId: null,
  kind: "rechnung",
  variant: "abschlag",
  advanceType: "anzahlung",
  number: "A1",
  party: "Musterkunde",
  issueDate: "2026-12-01",
  dueDate: "2026-12-15",
  performanceDate: "2026-12-01",
  gross: 35_700,
};
const final: DeferredInvoice = {
  ...advance,
  id: "f",
  number: "S1",
  variant: "schluss",
  advanceType: null,
  issueDate: "2027-01-20",
  dueDate: "2027-02-03",
  performanceDate: "2027-01-20",
  gross: 83_300,
};
const cancel: DeferredInvoice = { ...final, id: "s", number: "ST1", correctsId: "f", kind: "storno", variant: null, issueDate: "2027-02-12", gross: -83_300 };
const replacement: DeferredInvoice = { ...final, id: "r", number: "S2", replacesInvoiceId: "f", issueDate: "2027-03-12", dueDate: "2027-03-26" };
const part: DeferredSettlement = { invoiceId: "a", date: "2026-12-12", amount: 11_900, net: 10_000, kind: "payment" };
const deductions = [
  { invoiceId: "f", advanceId: "a" },
  { invoiceId: "r", advanceId: "a" },
];
const summary = (stand: ReturnType<typeof advanceReceivables>) => ({
  receivables: stand.receivables,
  requests: stand.requests,
  unbilled: stand.unbilled,
  netAdvances: stand.netAdvances,
});

describe("Anforderungen und realisierte Ansprüche zum Stichtag", () => {
  it("leerer Umfang hat keine Ansprüche oder Verbindlichkeiten", () => {
    expect(summary(advanceReceivables([], [], [], "2026-12-31"))).toEqual({ receivables: 0, requests: 0, unbilled: 0, netAdvances: 0 });
  });

  it("eine unbezahlte Anforderung bleibt vor Leistung außerhalb der bilanzierten Forderungen", () => {
    const stand = advanceReceivables([advance], [], [], "2026-12-31");
    expect(summary(stand)).toEqual({ receivables: 0, requests: 35_700, unbilled: 0, netAdvances: 0 });
    expect(stand.positions).toMatchObject([{ id: "a", kind: "request", open: 35_700 }]);
  });

  it("Teilzahlung erzeugt nur den gespeicherten Netto-Anzahlungsbestand; spätere Zahlung ändert den alten Stichtag nicht", () => {
    const later: DeferredSettlement = { ...part, date: "2027-02-12", amount: 23_800, net: 20_000 };
    expect(summary(advanceReceivables([advance], [part, later], [], "2026-12-31"))).toEqual({
      receivables: 0,
      requests: 23_800,
      unbilled: 0,
      netAdvances: 10_000,
    });
  });

  it("Schlussleistung bilanziert auch den unbezahlten Anforderungsrest und löst den Anzahlungsbestand auf", () => {
    const stand = advanceReceivables([advance, final], [part], deductions, "2027-01-31");
    expect(summary(stand)).toEqual({ receivables: 107_100, requests: 0, unbilled: 0, netAdvances: 0 });
    expect(stand.positions).toMatchObject([
      { id: "a", kind: "receivable", open: 23_800 },
      { id: "f", kind: "receivable", open: 83_300 },
    ]);
    expect(summary(advanceReceivables([advance, final], [part], deductions, "2026-12-31"))).toEqual({
      receivables: 0,
      requests: 23_800,
      unbilled: 0,
      netAdvances: 10_000,
    });
  });

  it("Papierzwischenraum und Ersatz zählen denselben Schlussrest einmal, mit der damals geltenden Fälligkeit", () => {
    const paid: DeferredSettlement[] = [
      { ...part, amount: 35_700, net: 30_000 },
      { ...part, invoiceId: "f", date: "2027-01-25", amount: 10_000, net: 8_403 },
      { ...part, invoiceId: "r", date: "2027-04-20", amount: 73_300, net: 61_597 },
    ];
    const inputs = [advance, final, cancel, replacement];
    const february = advanceReceivables(inputs, paid, deductions, "2027-02-28");
    expect(summary(february)).toEqual({ receivables: 73_300, requests: 0, unbilled: 73_300, netAdvances: 0 });
    expect(february.positions).toMatchObject([{ id: "f", originId: "f", kind: "unbilled", open: 73_300, dueDate: "2027-02-03" }]);
    const march = advanceReceivables(inputs, paid, deductions, "2027-03-31");
    expect(summary(march)).toEqual({ receivables: 73_300, requests: 0, unbilled: 0, netAdvances: 0 });
    expect(march.positions).toMatchObject([{ id: "r", originId: "f", kind: "receivable", open: 73_300, dueDate: "2027-03-26" }]);
    expect(summary(advanceReceivables(inputs, paid, deductions, "2027-04-30"))).toEqual({ receivables: 0, requests: 0, unbilled: 0, netAdvances: 0 });
  });

  it("nach dem Stichtag ausgestellter Schluss kann bereits erbrachte Leistung belegen", () => {
    const late = { ...final, issueDate: "2027-02-10", dueDate: "2027-02-24" };
    const stand = advanceReceivables([advance, late], [part], deductions, "2027-01-31");
    expect(summary(stand)).toEqual({ receivables: 107_100, requests: 0, unbilled: 83_300, netAdvances: 0 });
    expect(stand.positions.find((p) => p.originId === "f")).toMatchObject({ kind: "unbilled", date: "2027-01-20" });
  });

  it("echte Anforderungs-Erstattung bleibt bis zum Geldrückfluss eine Anzahlungsverbindlichkeit, keine AR-Forderung", () => {
    const revoked: DeferredInvoice = {
      ...advance,
      id: "as",
      correctsId: "a",
      kind: "storno",
      variant: null,
      advanceType: null,
      issueDate: "2027-01-12",
      gross: -35_700,
    };
    const paid = { ...part, amount: 35_700, net: 30_000 };
    const stand = advanceReceivables([advance, revoked], [paid], [], "2027-01-31");
    expect(summary(stand)).toEqual({ receivables: 0, requests: 0, unbilled: 0, netAdvances: 30_000 });
    expect(stand.positions).toMatchObject([{ id: "as", kind: "refund", open: -35_700 }]);
    expect(
      summary(
        advanceReceivables([advance, revoked], [paid, { ...paid, invoiceId: "as", date: "2027-02-12", amount: -35_700, net: -30_000 }], [], "2027-02-28"),
      ),
    ).toEqual({ receivables: 0, requests: 0, unbilled: 0, netAdvances: 0 });
  });

  it("Skonto ist kein Zufluss; datierte Gegenzeilen heben die vorherige Erledigung auf", () => {
    const skonto: DeferredSettlement = { invoiceId: "a", date: "2026-12-12", amount: 714, net: 600, kind: "writeOff" };
    const paid: DeferredSettlement = { ...part, amount: 34_986, net: 29_400 };
    expect(summary(advanceReceivables([advance], [paid, skonto], [], "2026-12-31"))).toEqual({ receivables: 0, requests: 0, unbilled: 0, netAdvances: 29_400 });
    const reverse = { ...skonto, date: "2027-01-12", amount: -714, net: -600 };
    expect(summary(advanceReceivables([advance], [paid, skonto, reverse], [], "2027-01-31"))).toEqual({
      receivables: 0,
      requests: 714,
      unbilled: 0,
      netAdvances: 29_400,
    });
  });

  it("unabhängige gleiche Schlussbeträge werden ohne Ersatzbezug nicht zusammengelegt", () => {
    const separate: DeferredInvoice = { ...final, id: "independent", number: "S3" };
    const stand = advanceReceivables([final, separate], [], [], "2027-01-31");
    expect(stand.receivables).toBe(166_600);
    expect(stand.positions.map(({ id }) => id)).toEqual(["f", "independent"]);
  });
});
