import { describe, expect, it } from "vitest";
import { IMPORT_CONTRACT_VERSION, type SourceBinding, validateBatch } from "./index.ts";

const binding: SourceBinding = { provider: "beispielbank", externalAccountId: "konto-1", accountKind: "bank" };

const movement = (over: Record<string, unknown> = {}) => ({
  sourceEventId: "E-1",
  component: "main",
  kind: "payment",
  bookingDate: "2026-10-05",
  amount: -1190,
  currency: "EUR",
  counterpartyName: "Bürobedarf Muster",
  purpose: "Rechnung 4711",
  ...over,
});

const batch = (over: Record<string, unknown> = {}) => ({
  contractVersion: IMPORT_CONTRACT_VERSION,
  provider: "beispielbank",
  externalAccountId: "konto-1",
  idempotencyKey: "abruf-2026-10-31-teil-0",
  fetchedAt: "2026-10-31T08:00:00+01:00",
  coverage: { from: "2026-10-01", to: "2026-10-31" },
  part: { index: 0, last: true },
  movements: [movement()],
  ...over,
});

function problems(input: unknown, b: SourceBinding = binding): string[] {
  const result = validateBatch(input, b);
  if (result.ok) throw new Error("Lieferung wurde angenommen");
  return result.problems;
}

describe("validateBatch", () => {
  it("nimmt eine gültige Lieferung an und ergänzt Vorgaben", () => {
    const result = validateBatch(batch(), binding);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.references).toEqual({});
    expect(result.rejected).toEqual([]);
    expect(result.blocking).toBe(0);
  });

  it("lehnt eine andere Vertragsversion ab", () => {
    expect(problems(batch({ contractVersion: 2 }))).toEqual(["Vertragsversion 2 wird nicht unterstützt, erwartet 1."]);
  });

  it("lehnt Lieferungen für eine andere Quelle oder ein anderes Konto ab", () => {
    expect(problems(batch({ externalAccountId: "konto-2" }))).toEqual([
      "Die Lieferung gehört zu beispielbank/konto-2, das Konto ist mit beispielbank/konto-1 verknüpft.",
    ]);
  });

  it("meldet ungültige Felder mit Pfad, ohne Teile anzunehmen", () => {
    const p = problems(batch({ movements: [movement(), movement({ sourceEventId: "E-2", amount: 11.9 })] }));
    expect(p).toEqual(["Feld movements.1.amount ist ungültig."]);
  });

  it("lehnt Beträge als Text und unbekannte Felder ab", () => {
    expect(problems(batch({ movements: [movement({ amount: "-11,90" })] }))).toEqual(["Feld movements.0.amount ist ungültig."]);
    expect(problems(batch({ movements: [movement({ net: 900 })] }))).toEqual(["Feld movements.0 ist ungültig."]);
  });

  it("lehnt ein Fenster mit Ende vor dem Anfang ab", () => {
    expect(problems(batch({ coverage: { from: "2026-10-31", to: "2026-10-01" } }))).toEqual([
      "Das Fenster endet vor seinem Anfang (2026-10-31 bis 2026-10-01).",
    ]);
  });

  it("lehnt ein ungültiges Kalenderdatum ab", () => {
    expect(problems(batch({ movements: [movement({ bookingDate: "2026-02-30" })] }))).toEqual(["E-1/main: Buchungstag 2026-02-30 gibt es nicht."]);
  });

  it("lehnt Bewegungen außerhalb des Fensters ab", () => {
    expect(problems(batch({ movements: [movement({ bookingDate: "2026-11-01" })] }))).toEqual([
      "E-1/main: Buchungstag 2026-11-01 liegt außerhalb des Fensters 2026-10-01 bis 2026-10-31.",
    ]);
  });

  it("lehnt dieselbe Kennung und Komponente zweimal in einer Lieferung ab", () => {
    expect(problems(batch({ movements: [movement(), movement({ amount: -500 })] }))).toEqual(["E-1/main steht zweimal in der Lieferung."]);
  });

  it("erlaubt Hauptbetrag und Gebühr desselben Ereignisses", () => {
    const result = validateBatch(batch({ movements: [movement({ amount: 10000 }), movement({ component: "fee", amount: -300 })] }), binding);
    expect(result.ok && result.accepted.length).toBe(2);
  });

  it("behält gleichartige Umsätze mit verschiedenen Kennungen", () => {
    const result = validateBatch(batch({ movements: [movement(), movement({ sourceEventId: "E-2" })] }), binding);
    expect(result.ok && result.accepted.map((m) => m.sourceEventId)).toEqual(["E-1", "E-2"]);
  });

  it("weist Fremdwährung sichtbar zurück, das blockiert die Vollständigkeit", () => {
    const result = validateBatch(batch({ movements: [movement(), movement({ sourceEventId: "E-2", currency: "USD", amount: -2500 })] }), binding);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted.map((m) => m.sourceEventId)).toEqual(["E-1"]);
    expect(result.rejected).toEqual([{ sourceEventId: "E-2", component: "main", reason: "Währung USD: Haben übernimmt nur Euro.", blocking: true }]);
    expect(result.blocking).toBe(1);
  });

  it("nimmt Bewegungen vor dem Stichtag nicht an, ohne die Vollständigkeit zu blockieren", () => {
    const result = validateBatch(batch({ movements: [movement({ bookingDate: "2026-10-02" }), movement({ sourceEventId: "E-2" })] }), {
      ...binding,
      cutoverDate: "2026-10-03",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted.map((m) => m.sourceEventId)).toEqual(["E-2"]);
    expect(result.rejected).toEqual([
      { sourceEventId: "E-1", component: "main", reason: "Vor dem Stichtag 2026-10-03 der Quelle; diese Zeit decken Dateiimporte ab.", blocking: false },
    ]);
    expect(result.blocking).toBe(0);
  });

  it("weist Bewegungen mit Betrag 0 zurück", () => {
    const result = validateBatch(batch({ movements: [movement({ amount: 0 })] }), binding);
    expect(result.ok && result.rejected).toEqual([{ sourceEventId: "E-1", component: "main", reason: "Betrag ist 0.", blocking: false }]);
  });

  it("zählt nicht eingeordnete Ereignisse des Connectors als offen", () => {
    const result = validateBatch(batch({ unsupported: [{ sourceEventId: "E-9", reason: "Status P (ausstehend)" }] }), binding);
    expect(result.ok && result.blocking).toBe(1);
  });

  it("weist auf Erstattungen ohne Bezug zur ursprünglichen Zahlung hin", () => {
    const result = validateBatch(
      batch({
        movements: [
          movement({ sourceEventId: "R-1", kind: "refund", amount: 1500 }),
          movement({ sourceEventId: "R-2", kind: "refund", amount: 500, references: { relatedEventId: "E-1" } }),
        ],
      }),
      binding,
    );
    expect(result.ok && result.hints).toEqual(["R-1: Erstattung ohne Bezug zur ursprünglichen Zahlung."]);
  });

  it("übernimmt nur Salden in Euro", () => {
    const result = validateBatch(
      batch({
        balances: [
          { date: "2026-10-31", amount: 120000, currency: "EUR" },
          { date: "2026-10-31", amount: 5000, currency: "USD" },
        ],
      }),
      binding,
    );
    expect(result.ok && result.batch.balances).toEqual([{ date: "2026-10-31", amount: 120000, currency: "EUR" }]);
    expect(result.ok && result.hints).toEqual(["Saldo vom 2026-10-31 in USD nicht übernommen."]);
  });
});
