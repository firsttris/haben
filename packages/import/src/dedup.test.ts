import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkBalanceContinuity, parseStatement, transactionHash, withDedupHashes } from "./index.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url)));

describe("transactionHash", () => {
  const t = { bookingDate: "2026-09-29", amount: -1190, counterpartyIban: "DE44 5001 0517 5407 3249 31", purpose: "Rechnung  99812" };

  it("normalisiert IBAN und Verwendungszweck", () => {
    expect(transactionHash(t, 0)).toBe(
      transactionHash({ ...t, counterpartyIban: "de44500105175407324931", purpose: " rechnung 99812 " }, 0),
    );
    expect(transactionHash(t, 0)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("unterscheidet Vorkommen, Betrag und Datum", () => {
    const base = transactionHash(t, 0);
    expect(transactionHash(t, 1)).not.toBe(base);
    expect(transactionHash({ ...t, amount: -1191 }, 0)).not.toBe(base);
    expect(transactionHash({ ...t, bookingDate: "2026-09-30" }, 0)).not.toBe(base);
    expect(transactionHash({ ...t, counterpartyIban: undefined }, 0)).not.toBe(base);
  });
});

describe("withDedupHashes", () => {
  const neu = withDedupHashes(parseStatement(fixture("dkb-neu.csv")).transactions);
  const alt = withDedupHashes(parseStatement(fixture("dkb-alt.csv")).transactions);

  it("gibt echten Doppelbuchungen am selben Tag verschiedene Hashes", () => {
    expect(neu[2]!.dedupHash).not.toBe(neu[3]!.dedupHash);
    expect(new Set(neu.map((t) => t.dedupHash)).size).toBe(neu.length);
  });

  it("erkennt dieselben Umsätze in überlappenden Dateien", () => {
    const altHashes = new Set(alt.map((t) => t.dedupHash));
    const overlap = neu.filter((t) => altHashes.has(t.dedupHash));
    expect(overlap.map((t) => t.index)).toEqual([1, 2, 3, 4]);
  });

  it("ist bei erneutem Import derselben Datei stabil", () => {
    const again = withDedupHashes(parseStatement(fixture("dkb-neu.csv")).transactions);
    expect(again.map((t) => t.dedupHash)).toEqual(neu.map((t) => t.dedupHash));
  });

  it("erkennt dieselben Umsätze in CSV und CAMT der gleichen Bank", () => {
    const camt = withDedupHashes(parseStatement(fixture("camt053-001-02.xml")).transactions);
    const altHashes = new Set(alt.map((t) => t.dedupHash));
    // Die Steuerlastschrift ist im CAMT einen Tag früher gebucht und gilt daher als neuer Umsatz
    expect(camt.filter((t) => altHashes.has(t.dedupHash)).map((t) => t.index)).toEqual([0, 1, 3]);
  });
});

describe("checkBalanceContinuity", () => {
  it("passt, wenn Endsaldo und Anfangssaldo übereinstimmen", () => {
    const alt = parseStatement(fixture("dkb-alt.csv"));
    const next = { openingBalance: alt.closingBalance, periodFrom: "2026-10-01" };
    expect(checkBalanceContinuity(alt, next)).toEqual({ ok: true });
  });

  it("meldet eine Lücke", () => {
    const r = checkBalanceContinuity(
      { closingBalance: 1865872, periodTo: "2026-09-30" },
      { openingBalance: 1900000, periodFrom: "2026-10-15" },
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/^Lücke: Anfangssaldo 19\.000,00 € passt nicht zum Endsaldo 18\.658,72 €/);
    expect(r.message).toMatch(/des vorigen Imports/);
  });

  it("kann ohne Salden nicht prüfen", () => {
    const n26 = parseStatement(fixture("n26.csv"));
    const r = checkBalanceContinuity({ closingBalance: 100 }, n26);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/nicht geprüft/);
    expect(checkBalanceContinuity(null, n26).ok).toBe(true);
    expect(checkBalanceContinuity({}, { openingBalance: 5 }).message).toMatch(/keinen Endsaldo/);
  });

  it("vergleicht überlappende Zeiträume nicht direkt", () => {
    const alt = parseStatement(fixture("dkb-alt.csv"));
    const neu = parseStatement(fixture("dkb-neu.csv"));
    const r = checkBalanceContinuity(alt, neu);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/überschneidet/);
  });

  it("CAMT-Folgeauszug schließt an", () => {
    const camt = parseStatement(fixture("camt053-001-08.xml"));
    expect(checkBalanceContinuity({ closingBalance: -15000, periodTo: "2026-09-30" }, camt)).toEqual({ ok: true });
  });
});
