import type { EbTransaction } from "@haben/import";
import { describe, expect, it } from "vitest";
import { berlinTimestamp, vertragHinweise } from "./vertrag-abruf.ts";

const tx = (over: Partial<EbTransaction> = {}): EbTransaction => ({
  entry_reference: "ER-1",
  transaction_amount: { currency: "EUR", amount: "10.00" },
  credit_debit_indicator: "CRDT",
  status: "BOOK",
  booking_date: "2026-10-05",
  remittance_information: ["Zinsen"],
  ...over,
});

const abruf = (transactions: EbTransaction[], over = {}) => ({
  iban: "DE12500105170648489890",
  transactions,
  balances: [],
  dateFrom: "2026-10-01",
  dateTo: "2026-10-09",
  now: new Date("2026-10-09T20:00:00Z"),
  fetchId: "abruf-1",
  ...over,
});

describe("berlinTimestamp", () => {
  it("nennt Zeit und Offset in Deutschland, auch nach Mitternacht UTC-seitig", () => {
    expect(berlinTimestamp(new Date("2026-10-09T22:30:00Z"))).toBe("2026-10-10T00:30:00+02:00");
    expect(berlinTimestamp(new Date("2026-11-16T23:30:05Z"))).toBe("2026-11-17T00:30:05+01:00");
  });
});

describe("vertragHinweise", () => {
  it("meldet nichts, wenn der Abruf dem Vertrag entspricht", () => {
    expect(vertragHinweise(abruf([tx(), tx({ entry_reference: "ER-2" })]))).toEqual([]);
  });

  it("nennt gebuchte Umsätze ohne entry_reference", () => {
    expect(vertragHinweise(abruf([tx(), tx({ entry_reference: null, transaction_id: "T-9" }), tx({ entry_reference: null })]))).toEqual([
      "2 Umsätze ohne Referenz der Bank (entry_reference): gespeichert wie bisher; ein späterer Abruf über den Importvertrag (#306) erkennt sie nicht sicher wieder.",
    ]);
  });

  it("wiederholt vorgemerkte Umsätze nicht, die meldet schon der Abruf", () => {
    expect(vertragHinweise(abruf([tx({ status: "PDNG" })]))).toEqual([]);
  });

  it("nennt, was der Vertrag an der ganzen Lieferung ablehnt", () => {
    expect(vertragHinweise(abruf([tx({ booking_date: "2026-10-12" })]))).toEqual([
      "Prüfung nach dem Importvertrag (#306): ER-1/main: Buchungstag 2026-10-12 liegt außerhalb des Fensters 2026-10-01 bis 2026-10-09.",
    ]);
  });

  it("nennt die Umsätze ohne entry_reference auch dann, wenn der Vertrag die ganze Lieferung ablehnt", () => {
    expect(vertragHinweise(abruf([tx({ entry_reference: null }), tx({ entry_reference: "ER-2", booking_date: "2026-09-30" })]))).toEqual([
      "1 Umsatz ohne Referenz der Bank (entry_reference): gespeichert wie bisher; ein späterer Abruf über den Importvertrag (#306) erkennt sie nicht sicher wieder.",
      "Prüfung nach dem Importvertrag (#306): ER-2/main: Buchungstag 2026-09-30 liegt außerhalb des Fensters 2026-10-01 bis 2026-10-09.",
    ]);
  });

  it("zählt eine leere entry_reference wie eine fehlende", () => {
    expect(vertragHinweise(abruf([tx({ entry_reference: " " })]))).toEqual([
      "1 Umsatz ohne Referenz der Bank (entry_reference): gespeichert wie bisher; ein späterer Abruf über den Importvertrag (#306) erkennt sie nicht sicher wieder.",
    ]);
  });

  it("lässt einen Saldo mit einem Tag, den es nicht gibt, weg, statt die Lieferung abzulehnen", () => {
    const balances = [{ balance_amount: { currency: "EUR", amount: "1.00" }, balance_type: "CLBD", reference_date: "2026-02-30" }];
    expect(vertragHinweise(abruf([tx()], { balances }))).toEqual([]);
  });
});
