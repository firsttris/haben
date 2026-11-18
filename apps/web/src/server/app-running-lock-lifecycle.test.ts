import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const driver = vi.hoisted(() => ({ create: vi.fn(), reserve: vi.fn(), end: vi.fn() }));
vi.mock("postgres", () => ({ default: driver.create }));
vi.mock("./db/index.ts", () => ({ db: {}, schema: {} }));
vi.mock("./env.ts", () => ({ env: () => ({ DATABASE_URL: "postgres://unused.invalid/test" }) }));

describe("Lebensdauer der App-Sperre", () => {
  let closed: () => void;
  const connection = () => Object.assign(vi.fn().mockResolvedValue([]), { release: vi.fn() });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    driver.reserve.mockReset().mockResolvedValue(connection());
    driver.end.mockReset().mockResolvedValue(undefined);
    driver.create.mockReset().mockImplementation((_url: string, options: { onclose?: () => void }) => {
      closed = options.onclose ?? (() => {});
      return { reserve: driver.reserve, end: driver.end };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("startet nach Freigabe auch bei verspätetem close keinen Versuch mehr", async () => {
    const { holdAppRunningLock } = await import("./sso-mode.ts");
    const release = await holdAppRunningLock();
    closed();
    await release();
    closed();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(driver.reserve).toHaveBeenCalledTimes(1);
    expect(driver.end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("führt gleichzeitige close-Ereignisse in einem Wiederverbindungsversuch zusammen", async () => {
    const { holdAppRunningLock } = await import("./sso-mode.ts");
    const release = await holdAppRunningLock();
    try {
      closed();
      closed();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(driver.reserve).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await release();
    }
  });

  it("gibt eine erst während des Herunterfahrens erhaltene Reservierung sofort frei", async () => {
    const { holdAppRunningLock } = await import("./sso-mode.ts");
    const release = await holdAppRunningLock();
    const late = connection();
    let resolve!: (value: ReturnType<typeof connection>) => void;
    driver.reserve.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    closed();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(driver.reserve).toHaveBeenCalledTimes(2);
    const stopped = release();
    resolve(late);
    await stopped;
    expect(late.release).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();
    closed();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(driver.reserve).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("meldet einen Fehler beim ersten Erwerb und beendet den Client ohne Hintergrundversuch", async () => {
    const { holdAppRunningLock } = await import("./sso-mode.ts");
    driver.reserve.mockRejectedValueOnce(new Error("Start fehlgeschlagen"));
    await expect(holdAppRunningLock()).rejects.toThrow("Start fehlgeschlagen");
    expect(driver.end).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(driver.reserve).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
