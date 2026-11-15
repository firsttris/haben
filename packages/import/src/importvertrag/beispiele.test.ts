import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  advanceCheckpoint,
  classifyMovements,
  type ImportMovement,
  type KnownMovement,
  knownMovement,
  movementKey,
  type SourceBinding,
  validateBatch,
} from "./index.ts";

// Erfundene Lieferungen, siehe test-fixtures/importvertrag/README.md
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../test-fixtures/importvertrag/${name}.json`, import.meta.url), "utf8"));

const ebay: SourceBinding = { provider: "ebay", externalAccountId: "verkaeufer-beispiel", accountKind: "psp" };
const bank: SourceBinding = { provider: "enablebanking", externalAccountId: "beispielbank-konto-1", accountKind: "bank", cutoverDate: "2026-10-01" };
const paypal: SourceBinding = { provider: "paypal", externalAccountId: "haendler-beispiel", accountKind: "psp" };

function accept(input: unknown, binding: SourceBinding) {
  const result = validateBatch(input, binding);
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result;
}

const sum = (movements: ImportMovement[]) => movements.reduce((s, m) => s + m.amount, 0);
const remember = (binding: SourceBinding, movements: ImportMovement[]): Map<string, KnownMovement> =>
  new Map(movements.map((m) => [movementKey(binding, m), knownMovement(m)]));

describe("Beispiel eBay", () => {
  const first = accept(fixture("ebay"), ebay);

  it("übernimmt Verkauf, Gebühr, Erstattung, Abo und Auszahlung; zusammen ergeben sie 0", () => {
    expect(first.accepted).toHaveLength(8);
    expect(first.rejected).toEqual([]);
    expect(first.hints).toEqual([]);
    expect(sum(first.accepted)).toBe(0);
    // +49,99 € Zahlung und −10,06 € Gebühr ergeben die +39,93 €, die eBay gutschreibt; ein Netto kommt nicht dazu
    expect(sum(first.accepted.filter((m) => m.sourceEventId === "SALE-0001"))).toBe(3993);
  });

  it("legt nach einem Abbruch bei erneutem Abruf mit anderen Seitengrenzen nichts doppelt an und rückt vor", () => {
    const known = remember(ebay, first.accepted);
    const input = fixture("ebay");
    const parts = [input.movements.slice(0, 3), input.movements.slice(3)].map((movements, index) =>
      accept({ ...input, idempotencyKey: `neuer-abruf-teil-${index}`, part: { fetchId: "neuer-abruf", index, last: index === 1 }, movements }, ebay),
    );
    const outcomes = parts.flatMap((p) => classifyMovements(known, ebay, p.accepted).results.map((r) => r.outcome));
    expect(outcomes).toEqual(Array(8).fill("known"));
    // Der erste Versuch brach nach Seite 1 ab; der neue Abruf liefert das Fenster vollständig
    const aborted = { coverage: first.batch.coverage, part: { fetchId: "abgebrochen", index: 0, last: false }, blocking: 0, conflict: false };
    const results = [aborted, ...parts.map((p) => ({ coverage: p.batch.coverage, part: p.batch.part, blocking: p.blocking, conflict: false }))];
    expect(advanceCheckpoint("2026-09-30", results)).toEqual({ checkpoint: "2026-10-31", complete: true });
  });

  it("hält einen später geschwärzten Käufernamen als Beobachtung fest", () => {
    const known = remember(ebay, first.accepted);
    const input = fixture("ebay");
    input.movements[0].counterpartyName = undefined;
    const later = accept({ ...input, idempotencyKey: "nach-90-tagen" }, ebay);
    expect(classifyMovements(known, ebay, later.accepted).results[0]!.outcome).toBe("observation");
  });
});

describe("Beispiel Enable Banking", () => {
  const result = accept(fixture("enablebanking"), bank);

  it("übernimmt nichts vor dem Stichtag, ohne den Zeitraum deshalb offen zu lassen", () => {
    expect(result.rejected.map((r) => [r.sourceEventId, r.blocking])).toEqual([["ER-0999", false]]);
  });

  it("lässt den Zeitraum mit einem Umsatz ohne entry_reference offen", () => {
    expect(result.blocking).toBe(1);
    expect(
      advanceCheckpoint("2026-09-30", [{ coverage: result.batch.coverage, part: result.batch.part, blocking: result.blocking, conflict: false }]).complete,
    ).toBe(false);
  });

  it("behält zwei gleichartige Kartenzahlungen am selben Tag", () => {
    const outcomes = classifyMovements(new Map(), bank, result.accepted).results.map((r) => [r.movement.sourceEventId, r.outcome]);
    expect(outcomes).toEqual([
      ["ER-1001", "new"],
      ["ER-1002", "new"],
      ["ER-1003", "new"],
    ]);
  });

  it("hält Auszahlung beim Zahlungsdienstleister und Eingang auf der Bank als zwei Bewegungen", () => {
    const payout = accept(fixture("ebay"), ebay).accepted.find((m) => m.kind === "payout")!;
    const incoming = result.accepted.find((m) => m.references.endToEndId === "PAYOUT-0001")!;
    expect(payout.amount + incoming.amount).toBe(0);
    expect(movementKey(ebay, payout)).not.toBe(movementKey(bank, incoming));
  });
});

describe("Beispiel PayPal", () => {
  const result = accept(fixture("paypal"), paypal);

  it("zählt die Gebühr einmal und lässt den Zeitraum mit einem ausstehenden Ereignis offen", () => {
    expect(sum(result.accepted.filter((m) => m.sourceEventId === "PP-0001"))).toBe(9700);
    expect(sum(result.accepted.filter((m) => m.sourceEventId <= "PP-0003"))).toBe(0);
    expect(result.blocking).toBe(1);
    expect(advanceCheckpoint("2026-09-30", [{ coverage: result.batch.coverage, part: result.batch.part, blocking: result.blocking, conflict: false }])).toEqual(
      {
        checkpoint: "2026-09-30",
        complete: false,
        reason: "1 Ereignis ist nicht übernommen (fremde Währung oder vom Connector nicht eingeordnet); der Zeitraum bleibt offen.",
      },
    );
  });

  it("bildet eine nachträglich zurückgebuchte Zahlung (Status V) als zwei Ereignisse mit Bezug ab", () => {
    // Die Zahlung bleibt gebucht, die Rückbuchung ist ein eigenes Ereignis: nichts fehlt, nichts wird doppelt zurückgebucht
    const payment = result.accepted.find((m) => m.sourceEventId === "PP-0005" && m.component === "main")!;
    const reversal = result.accepted.find((m) => m.sourceEventId === "PP-0006")!;
    expect(reversal.kind).toBe("chargeback");
    expect(reversal.references.relatedEventId).toBe(payment.sourceEventId);
    expect(payment.amount + reversal.amount).toBe(0);
    expect(result.hints).toEqual([]);
  });
});
