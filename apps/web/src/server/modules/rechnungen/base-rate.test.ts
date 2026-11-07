import { describe, expect, it, vi } from "vitest";
import { fetchBaseRate } from "./base-rate.ts";

const CSV = "TIME_PERIOD;OBS_VALUE;BBK_ID\n2026-11;1.52;BBIN1.M.DE.BBK.BBKBAS2.EUR.ME\n";

const fakeFetch = (body: string, status = 200) => vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

describe("fetchBaseRate", () => {
  it("fragt die Zeitreihe der Bundesbank als CSV ab", async () => {
    const fetchImpl = fakeFetch(CSV);
    expect(await fetchBaseRate("2026-11-07", fetchImpl)).toEqual({ month: "2026-11", basisPoints: 152, current: true });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(String(url)).toContain("BBIN1/M.DE.BBK.BBKBAS2.EUR.ME");
    expect(init?.headers).toMatchObject({ accept: "text/csv" });
  });

  it("markiert einen Wert aus dem vorigen Halbjahr", async () => {
    expect(await fetchBaseRate("2027-01-02", fakeFetch(CSV))).toMatchObject({ current: false });
  });

  it("meldet Fehler verständlich", async () => {
    await expect(fetchBaseRate("2026-11-07", fakeFetch("", 503))).rejects.toThrow(/HTTP 503/);
    await expect(fetchBaseRate("2026-11-07", fakeFetch('{"status":404}'))).rejects.toThrow(/keinen Basiszinssatz/);
    const offline = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    await expect(fetchBaseRate("2026-11-07", offline)).rejects.toThrow(/nicht erreichbar: getaddrinfo/);
  });
});
