import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latestStableVersion } from "./neueste-version.ts";

const DAY = 24 * 60 * 60 * 1000;
const state = globalThis as { __habenNeuesteVersion?: unknown; __habenNeuesteVersionLaeuft?: unknown };

const antwort = (tag: string, status = 200) => new Response(JSON.stringify({ tag_name: tag }), { status });
const nachbildung = (...antworten: (Response | Error)[]) => {
  const fetchMock = vi.fn(async () => {
    const next = antworten.shift();
    if (next instanceof Error) throw next;
    return next ?? antwort("v9.9.9");
  });
  return fetchMock as typeof fetchMock & typeof fetch;
};

describe("Neueste stabile Version (#1239)", () => {
  beforeEach(() => {
    state.__habenNeuesteVersion = undefined;
    state.__habenNeuesteVersionLaeuft = undefined;
    delete process.env.HABEN_UPDATE_CHECK;
  });
  afterEach(() => {
    delete process.env.HABEN_UPDATE_CHECK;
  });

  it("liefert die Version ohne „v“ und schickt nichts über die Instanz mit", async () => {
    const f = nachbildung(antwort("v1.4.2"));
    expect(await latestStableVersion(0, f)).toBe("1.4.2");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/Speicherstadt/haben/releases/latest");
    expect(init.headers).toEqual({ Accept: "application/vnd.github+json", "User-Agent": "Haben" });
    expect(init.credentials).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("ignoriert Release Candidates und fremde Tags", async () => {
    expect(await latestStableVersion(0, nachbildung(antwort("v1.5.0-rc.1")))).toBeNull();
    state.__habenNeuesteVersion = undefined;
    expect(await latestStableVersion(0, nachbildung(antwort("nightly")))).toBeNull();
  });

  it("gibt bei Fehlern, Statuscodes und kaputter Antwort null zurück, ohne zu werfen", async () => {
    expect(await latestStableVersion(0, nachbildung(new Error("offline")))).toBeNull();
    state.__habenNeuesteVersion = undefined;
    expect(await latestStableVersion(0, nachbildung(antwort("v1.0.0", 403)))).toBeNull();
    state.__habenNeuesteVersion = undefined;
    expect(await latestStableVersion(0, nachbildung(new Response("kein json")))).toBeNull();
    state.__habenNeuesteVersion = undefined;
    expect(await latestStableVersion(0, nachbildung(new Response(JSON.stringify({ x: 1 }))))).toBeNull();
  });

  it("fragt abgeschaltet gar nicht erst", async () => {
    process.env.HABEN_UPDATE_CHECK = "off";
    const f = nachbildung(antwort("v1.0.0"));
    expect(await latestStableVersion(0, f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("fragt innerhalb von 24 Stunden nur einmal, auch nach einem Fehler, danach wieder", async () => {
    const f = nachbildung(antwort("v1.0.0"), antwort("v1.1.0"));
    expect(await latestStableVersion(0, f)).toBe("1.0.0");
    expect(await latestStableVersion(DAY - 1, f)).toBe("1.0.0");
    expect(f).toHaveBeenCalledTimes(1);
    expect(await latestStableVersion(DAY, f)).toBe("1.1.0");
    expect(f).toHaveBeenCalledTimes(2);

    state.__habenNeuesteVersion = undefined;
    const kaputt = nachbildung(new Error("offline"), antwort("v2.0.0"));
    expect(await latestStableVersion(0, kaputt)).toBeNull();
    expect(await latestStableVersion(1000, kaputt)).toBeNull();
    expect(kaputt).toHaveBeenCalledTimes(1);
  });

  it("teilt sich bei gleichzeitigen Aufrufen eine Anfrage", async () => {
    const f = nachbildung(antwort("v1.2.0"));
    const ergebnisse = await Promise.all([latestStableVersion(0, f), latestStableVersion(0, f), latestStableVersion(0, f)]);
    expect(ergebnisse).toEqual(["1.2.0", "1.2.0", "1.2.0"]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
