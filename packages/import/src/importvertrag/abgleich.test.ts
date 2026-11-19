import { describe, expect, it } from "vitest";
import {
  batchFingerprint,
  classifyBatch,
  classifyMovements,
  type ImportBatch,
  type ImportMovement,
  knownMovement,
  movementKey,
  type SourceBinding,
} from "./index.ts";

const binding: SourceBinding = { provider: "beispielpsp", externalAccountId: "haendler-7", accountKind: "psp" };

const movement = (over: Partial<ImportMovement> = {}): ImportMovement => ({
  sourceEventId: "T-1",
  component: "main",
  kind: "payment",
  bookingDate: "2026-10-05",
  amount: 10000,
  currency: "EUR",
  counterpartyName: "Erika Beispiel",
  purpose: "Bestellung 1001",
  references: {},
  ...over,
});

const batch = (over: Partial<ImportBatch> = {}): ImportBatch => ({
  contractVersion: 1,
  provider: "beispielpsp",
  externalAccountId: "haendler-7",
  idempotencyKey: "k-1",
  fetchedAt: "2026-10-31T08:00:00Z",
  coverage: { from: "2026-10-01", to: "2026-10-31" },
  part: { fetchId: "abruf-1", index: 0, last: true },
  movements: [movement()],
  balances: [],
  unsupported: [],
  ...over,
});

describe("movementKey", () => {
  it("unterscheidet Komponenten und Quellen, nicht die Verbindung", () => {
    expect(movementKey(binding, movement())).not.toBe(movementKey(binding, movement({ component: "fee" })));
    expect(movementKey(binding, movement())).not.toBe(movementKey({ ...binding, externalAccountId: "haendler-8" }, movement()));
    // Neue Zustimmung, neue Zugangsdaten: dieselbe Quellenbindung, derselbe Schlüssel
    const withCutover: SourceBinding = { ...binding, cutoverDate: "2026-01-01" };
    expect(movementKey(withCutover, movement())).toBe(movementKey(binding, movement()));
  });

  it("ist eindeutig, auch wenn Kennungen Trennzeichen enthalten", () => {
    const a = movementKey({ ...binding, provider: "a|b", externalAccountId: "c" }, movement());
    const b = movementKey({ ...binding, provider: "a", externalAccountId: "b|c" }, movement());
    expect(a).not.toBe(b);
  });
});

describe("classifyBatch", () => {
  it("erkennt eine neue Lieferung", () => {
    expect(classifyBatch(undefined, batch())).toEqual({ outcome: "new" });
  });

  it("gibt bei derselben Lieferung nach verlorener Antwort das bisherige Ergebnis zurück", () => {
    expect(classifyBatch({ fingerprint: batchFingerprint(batch()) }, batch())).toEqual({ outcome: "replay" });
  });

  it("hängt nicht an der Reihenfolge der Schlüssel", () => {
    const reordered = Object.fromEntries(Object.entries(batch()).reverse()) as ImportBatch;
    expect(Object.keys(reordered)[0]).toBe("unsupported");
    expect(batchFingerprint(reordered)).toBe(batchFingerprint(batch()));
  });

  it("meldet einen Konflikt bei gleichem Schlüssel mit anderem Inhalt", () => {
    const changed = batch({ movements: [movement({ amount: 9900 })] });
    expect(classifyBatch({ fingerprint: batchFingerprint(batch()) }, changed)).toEqual({
      outcome: "conflict",
      message: "Lieferung k-1 kam schon mit anderem Inhalt; Haben nimmt sie nicht noch einmal an.",
    });
  });
});

describe("classifyMovements", () => {
  const known = new Map([[movementKey(binding, movement()), [knownMovement(movement())]]]);

  it("legt unbekannte Bewegungen neu an, auch gleichartige mit anderer Kennung", () => {
    const result = classifyMovements(known, binding, [movement({ sourceEventId: "T-2" })]);
    expect(result.results.map((r) => r.outcome)).toEqual(["new"]);
    expect(result.conflicts).toEqual([]);
  });

  it("legt eine bekannte Bewegung bei Überlappung oder Seitenwechsel nicht doppelt an", () => {
    expect(classifyMovements(known, binding, [movement()]).results.map((r) => r.outcome)).toEqual(["known"]);
  });

  it("hält zusätzliche Angaben als Beobachtung fest, ohne zu überschreiben", () => {
    // Später geschwärzter Name (eBay nach etwa 90 Tagen) oder eine nachgereichte Referenz
    const result = classifyMovements(known, binding, [movement({ counterpartyName: undefined, references: { payoutId: "P-1" } })]);
    expect(result.results.map((r) => r.outcome)).toEqual(["observation"]);
  });

  it("meldet geänderten Betrag, Buchungstag oder Währung als Konflikt", () => {
    const result = classifyMovements(known, binding, [movement({ amount: 9900, bookingDate: "2026-10-06" })]);
    expect(result.results.map((r) => r.outcome)).toEqual(["conflict"]);
    expect(result.conflicts).toEqual(["T-1/main: Betrag 100,00 € → 99,00 €, Buchungstag 05.10.2026 → 06.10.2026; nichts überschrieben."]);
  });

  it("meldet eine geänderte Art als Konflikt", () => {
    const result = classifyMovements(known, binding, [movement({ kind: "payout" })]);
    expect(result.conflicts).toEqual(["T-1/main: Art payment → payout; nichts überschrieben."]);
  });

  it("erkennt einen geklärten Kern als bekannt, einen weiteren wieder als Konflikt (#306, 3b)", () => {
    // Die Bank lieferte 99,00 € statt 100,00 €; der Nutzer hat den Konflikt geklärt, beide Kerne gelten als bekannt
    const geklaert = new Map([[movementKey(binding, movement()), [knownMovement(movement()), knownMovement(movement({ amount: 9900 }))]]]);
    expect(classifyMovements(geklaert, binding, [movement({ amount: 9900 })]).results.map((r) => r.outcome)).toEqual(["known"]);
    expect(classifyMovements(geklaert, binding, [movement()]).results.map((r) => r.outcome)).toEqual(["known"]);
    const dritter = classifyMovements(geklaert, binding, [movement({ amount: 9800 })]);
    expect(dritter.results.map((r) => r.outcome)).toEqual(["conflict"]);
    // Die Meldung nennt den zuerst übernommenen Kern
    expect(dritter.conflicts).toEqual(["T-1/main: Betrag 100,00 € → 98,00 €; nichts überschrieben."]);
  });

  it("erkennt Hauptbetrag und Gebühr getrennt", () => {
    const result = classifyMovements(known, binding, [movement(), movement({ component: "fee", amount: -300 })]);
    expect(result.results.map((r) => r.outcome)).toEqual(["known", "new"]);
  });
});
