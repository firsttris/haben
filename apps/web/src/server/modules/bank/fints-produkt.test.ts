import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Die FinTS-Produktnummer kommt nur aus FINTS_PRODUKT_ID (#654): Haben bringt keine mit, ohne sie bleibt FinTS aus.
 */

describe("FINTS_PRODUKT_ID", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("FINTS_PRODUKT_ID", "");
    vi.stubEnv("DATABASE_URL", "postgres://test@localhost/test");
    vi.stubEnv("BETTER_AUTH_URL", "https://haben.example.de");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    vi.stubEnv("HABEN_ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
  });
  afterEach(() => vi.unstubAllEnvs());
  const load = () => import("./fints-produkt.ts");

  it("lässt FinTS ohne Nummer aus und sagt, wer sie einträgt", async () => {
    const produkt = await load();
    expect(produkt.fintsConfigured()).toBe(false);
    expect(produkt.fintsProdukt()).toBeNull();
    expect(() => produkt.fintsProduktOderFehler()).toThrow(
      "FinTS ist nicht eingerichtet: Der Betreiber trägt die Registrierungsnummer in FINTS_PRODUKT_ID ein.",
    );
  });

  it("nimmt die Nummer des Betreibers und die Version von Haben", async () => {
    vi.stubEnv("FINTS_PRODUKT_ID", "ABCDEF0123456789ABCDEF012");
    const produkt = await load();
    expect(produkt.fintsConfigured()).toBe(true);
    expect(produkt.fintsProdukt()).toEqual({ id: "ABCDEF0123456789ABCDEF012", version: expect.stringMatching(/^\d+\.\d+$/) });
  });

  it("startet nicht mit einer Nummer, die keine sein kann", async () => {
    vi.stubEnv("FINTS_PRODUKT_ID", "ABC DEF");
    const { env } = await import("../../env.ts");
    expect(() => env()).toThrow(/FINTS_PRODUKT_ID/);
    vi.stubEnv("FINTS_PRODUKT_ID", "A".repeat(26));
    vi.resetModules();
    const zweiter = await import("../../env.ts");
    expect(() => zweiter.env()).toThrow(/FINTS_PRODUKT_ID/);
  });

  it("kürzt die Version auf Haupt- und Nebenversion, höchstens fünf Zeichen (HKVVB an..5)", async () => {
    const { fintsProduktVersion } = await load();
    expect(fintsProduktVersion("0.9.0")).toBe("0.9");
    expect(fintsProduktVersion("0.10.3")).toBe("0.10");
    expect(fintsProduktVersion("12.345.1")).toBe("12.34");
  });
});
