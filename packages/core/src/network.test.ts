import { describe, expect, it } from "vitest";
import { networkErrorText } from "./network.ts";

const fetchFailed = (cause: unknown) => new TypeError("fetch failed", { cause });
const withCode = (code: string) => Object.assign(new Error(`getaddrinfo ${code}`), { code });

describe("networkErrorText", () => {
  it("nennt DNS-Fehler mit Code", () => {
    expect(networkErrorText(fetchFailed(withCode("EAI_AGAIN")))).toBe("Name nicht auflösbar, DNS antwortet nicht (EAI_AGAIN)");
    expect(networkErrorText(fetchFailed(withCode("ENOTFOUND")))).toBe("Name nicht auflösbar (ENOTFOUND)");
  });

  it("weist bei Verbindungsfehlern auf Firewall oder Proxy hin", () => {
    expect(networkErrorText(fetchFailed(withCode("ECONNREFUSED")))).toBe("Verbindung abgelehnt, Firewall oder Proxy prüfen (ECONNREFUSED)");
  });

  it("findet den Code in einem AggregateError", () => {
    const aggregate = new AggregateError([withCode("ETIMEDOUT"), withCode("ENETUNREACH")]);
    expect(networkErrorText(fetchFailed(aggregate))).toBe("Zeitüberschreitung, Firewall oder Proxy prüfen (ETIMEDOUT)");
  });

  it("erkennt Zertifikatsfehler", () => {
    expect(networkErrorText(fetchFailed(withCode("UNABLE_TO_VERIFY_LEAF_SIGNATURE")))).toBe(
      "Zertifikat nicht vertrauenswürdig, TLS-Proxy oder CA prüfen (UNABLE_TO_VERIFY_LEAF_SIGNATURE)",
    );
  });

  it("nimmt sonst die Meldung", () => {
    expect(networkErrorText(fetchFailed(new Error("kaputt")))).toBe("fetch failed");
    expect(networkErrorText(fetchFailed(withCode("EWEIRD")))).toBe("fetch failed (EWEIRD)");
    expect(networkErrorText("offline")).toBe("offline");
  });
});
