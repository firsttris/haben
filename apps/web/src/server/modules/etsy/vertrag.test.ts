import type { EtsyLedgerEntry } from "@haben/import";
import { describe, expect, it } from "vitest";
import { etsyVertragHinweise } from "./vertrag.ts";

/** 2026-11-10 09:00:00 UTC in Epoch-Sekunden */
const T = Date.UTC(2026, 10, 10, 9, 0, 0) / 1000;
const NOW = new Date("2026-11-16T12:00:00Z");

const entry = (e: Partial<EtsyLedgerEntry> & Pick<EtsyLedgerEntry, "amount" | "ledger_type">): EtsyLedgerEntry => ({
  currency: "EUR",
  created_timestamp: T,
  ...e,
});

const abruf = (entries: EtsyLedgerEntry[], orderFor?: (id: string) => string | undefined) =>
  etsyVertragHinweise({ shopId: "12345678", entries, fetchFrom: "2026-11-01", now: NOW, orderFor });

describe("etsyVertragHinweise", () => {
  it("meldet nichts, wenn der Abruf dem Vertrag entspricht", () => {
    expect(
      abruf([
        entry({ entry_id: 1, sequence_number: 1, amount: 2500, ledger_type: "PAYMENT_GROSS", balance: 2500 }),
        entry({ entry_id: 2, sequence_number: 2, amount: -200, ledger_type: "PAYMENT_PROCESSING_FEE", balance: 2300 }),
      ]),
    ).toEqual([]);
  });

  it("nennt Zeilen ohne entry_id, weil ein späterer Abruf sie nicht sicher wiedererkennt", () => {
    const hinweise = abruf([
      entry({ entry_id: 1, sequence_number: 1, amount: 2500, ledger_type: "PAYMENT_GROSS" }),
      entry({ sequence_number: 2, amount: -200, ledger_type: "PAYMENT_PROCESSING_FEE" }),
    ]);
    expect(hinweise).toEqual([expect.stringMatching(/^1 Zeile ohne Kennung \(entry_id\)/)]);
  });

  it("doppelt den Hinweis des Parsers auf unbekannte Typen nicht", () => {
    expect(abruf([entry({ entry_id: 1, sequence_number: 1, amount: -99, ledger_type: "neue_gebuehr" })])).toEqual([]);
  });

  it("gibt den Hinweis des Vertrags auf eine Erstattung ohne Bezug weiter", () => {
    const hinweise = abruf([entry({ entry_id: 7, sequence_number: 1, amount: -900, ledger_type: "REFUND_GROSS", reference_id: "9003" })], () => "3000000002");
    expect(hinweise).toEqual(["7: Erstattung ohne Bezug zur ursprünglichen Zahlung."]);
  });

  it("meldet eine abgelehnte Lieferung mit Grund, statt den Abruf scheitern zu lassen", () => {
    // Zwei Zeilen mit derselben entry_id lehnt der Vertrag als Ganzes ab
    const hinweise = abruf([
      entry({ entry_id: 5, sequence_number: 1, amount: -20, ledger_type: "listing" }),
      entry({ entry_id: 5, sequence_number: 2, amount: -20, ledger_type: "listing" }),
    ]);
    expect(hinweise).toEqual([expect.stringMatching(/^Prüfung nach dem Importvertrag: .*zweimal/)]);
  });
});
