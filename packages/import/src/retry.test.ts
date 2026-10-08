import { describe, expect, it } from "vitest";
import { backoff, parseRetryAfter } from "./retry.ts";

describe("parseRetryAfter", () => {
  const now = Date.UTC(2026, 9, 2, 12);
  it("liest Sekunden und HTTP-Datum, begrenzt auf 5 Minuten", () => {
    expect(parseRetryAfter("7", now)).toBe(7000);
    expect(parseRetryAfter(" 1.5 ", now)).toBe(1500);
    expect(parseRetryAfter("86400", now)).toBe(300_000);
    expect(parseRetryAfter(new Date(now + 30_000).toUTCString(), now)).toBe(30_000);
    expect(parseRetryAfter(new Date(now - 30_000).toUTCString(), now)).toBe(0);
  });

  it("liefert null für fehlende oder unbrauchbare Werte", () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("", now)).toBeNull();
    expect(parseRetryAfter("bald", now)).toBeNull();
  });
});

describe("backoff", () => {
  it("verdoppelt bis höchstens 60 Sekunden", () => {
    expect([0, 1, 2, 10].map(backoff)).toEqual([1000, 2000, 4000, 60_000]);
  });
});
