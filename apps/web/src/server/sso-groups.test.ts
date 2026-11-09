import { describe, expect, it } from "vitest";
import { decideRole, proofExpiry, SSO_PROOF_MS } from "./sso-groups.ts";

const config = { claim: "groups", inhaber: "haben-inhaber", steuerberatung: "haben-steuerberatung" };

describe("Gruppenentscheidung im SSO-Modus", () => {
  it.each([
    [["haben-inhaber"], "inhaber"],
    [["haben-steuerberatung"], "steuerberatung"],
    [["admins", "haben-inhaber", "dev"], "inhaber"],
    [["familie", "haben-steuerberatung"], "steuerberatung"],
  ])("gibt %j die Rolle %s, fremde Gruppen zählen nicht", (groups, role) => {
    expect(decideRole({ groups }, config)).toEqual({ ok: true, role });
  });

  it.each([
    [{}, "fehlt"],
    [{ groups: null }, "ungueltig"],
    [{ groups: "haben-inhaber" }, "ungueltig"],
    [{ groups: { 0: "haben-inhaber" } }, "ungueltig"],
    [{ groups: ["haben-inhaber", 1] }, "ungueltig"],
    [{ groups: [["haben-inhaber"]] }, "ungueltig"],
    [{ groups: [] }, "keine"],
    [{ groups: ["admins"] }, "keine"],
    [{ groups: ["Haben-Inhaber", "haben-inhaber "] }, "keine"],
    [{ groups: ["haben-inhaber", "haben-steuerberatung"] }, "beide"],
  ])("verweigert %j (%s)", (profile, reason) => {
    expect(decideRole(profile, config)).toEqual({ ok: false, reason });
  });

  it("liest genau den konfigurierten Claim und wertet keinen Pfad aus", () => {
    expect(decideRole({ "haben.gruppen": ["haben-inhaber"] }, { ...config, claim: "haben.gruppen" })).toEqual({ ok: true, role: "inhaber" });
    expect(decideRole({ haben: { gruppen: ["haben-inhaber"] } }, { ...config, claim: "haben.gruppen" })).toEqual({ ok: false, reason: "fehlt" });
    // Geerbte Eigenschaften sind keine Claims
    expect(decideRole(Object.create({ groups: ["haben-inhaber"] }), config)).toEqual({ ok: false, reason: "fehlt" });
  });
});

describe("Frist der Berechtigung", () => {
  const now = 1_800_000_000_000;
  it("gilt höchstens 15 Minuten", () => {
    expect(proofExpiry(now, [now + 3_600_000])).toBe(now + SSO_PROOF_MS);
    expect(SSO_PROOF_MS).toBe(15 * 60_000);
  });
  it("endet früher, wenn ein Token früher abläuft", () => {
    expect(proofExpiry(now, [now + 60_000, now + 3_600_000])).toBe(now + 60_000);
    expect(proofExpiry(now, [undefined, now + 120_000])).toBe(now + 120_000);
  });
  it("gibt keine Frist für schon abgelaufene Tokens", () => {
    expect(proofExpiry(now, [now])).toBeNull();
    expect(proofExpiry(now, [now - 1])).toBeNull();
  });
});
