import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const csv = (month: string, value: string) => `TIME_PERIOD;OBS_VALUE\n${month};${value}\n`;
const fakeFetch = (body: string) => vi.fn(async () => new Response(body)) as unknown as typeof fetch;
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!testDatabaseUrl)("Basiszinssatz automatisch (Postgres)", () => {
  let sql: postgres.Sql;
  let job: typeof import("./base-rate-job.ts");
  let guard: typeof import("../stammdaten/settings-guard.ts");
  let company: typeof import("../stammdaten/company.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    job = await import("./base-rate-job.ts");
    guard = await import("../stammdaten/settings-guard.ts");
    company = await import("../stammdaten/company.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate company cascade`;
    delete (globalThis as { __habenBasiszinsAbgerufen?: number }).__habenBasiszinsAbgerufen;
  });

  const dunning = (extra: object) => JSON.stringify({ baseRate: 127, fees: { "1": 0, "2": 0, "3": 0 }, deadlineDays: 10, ...extra });
  const stored = async () => (await company.loadCompany()).dunning;

  it("ohne Haken kein Abruf", async () => {
    await sql`insert into company (id, dunning) values (1, ${dunning({})}::jsonb)`;
    const fetchImpl = fakeFetch(csv("2027-01", "1.80"));
    expect(await job.runDueBaseRate("2027-01-02", Date.now(), fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("nach dem Stichtag einmal am Tag, bis der neue Satz da ist; danach bis zum nächsten Stichtag nicht mehr", async () => {
    await sql`insert into company (id, dunning) values (1, ${dunning({ autoBaseRate: true, baseRateSince: "2026-07" })}::jsonb)`;
    const now = Date.now();

    // Mitte des Halbjahrs: schon bestätigt, keine Anfrage
    const idle = fakeFetch(csv("2026-11", "1.52"));
    expect(await job.runDueBaseRate("2026-11-07", now, idle)).toBeNull();
    expect(idle).not.toHaveBeenCalled();

    // 1. Januar: Reihe noch auf Dezember → nichts gespeichert, am selben Tag kein zweiter Versuch
    const old = fakeFetch(csv("2026-12", "1.52"));
    expect(await job.runDueBaseRate("2027-01-01", now, old)).toEqual({ updated: false, month: "2026-12" });
    expect(await job.runDueBaseRate("2027-01-01", now + 60_000, old)).toBeNull();
    expect(old).toHaveBeenCalledTimes(1);
    expect(await stored()).toMatchObject({ baseRate: 127, baseRateSince: "2026-07" });

    // Am nächsten Tag steht der neue Satz drin
    const fresh = fakeFetch(csv("2027-01", "1.80"));
    expect(await job.runDueBaseRate("2027-01-02", now + DAY, fresh)).toMatchObject({ updated: true, basisPoints: 180, changed: true });
    expect(await stored()).toMatchObject({ baseRate: 180, baseRateSince: "2027-01", autoBaseRate: true });
    const audit = await sql`select actor from audit_log where table_name = 'company' order by seq desc limit 1`;
    expect(audit[0]?.actor).toBe("system:basiszins");

    // Danach Ruhe bis zum 1. Juli
    const later = fakeFetch(csv("2027-03", "1.80"));
    expect(await job.runDueBaseRate("2027-03-15", now + 70 * DAY, later)).toBeNull();
    expect(later).not.toHaveBeenCalled();
  });

  it("von Hand geänderter Satz hebt die Bestätigung auf, unveränderter behält sie", async () => {
    await sql`insert into company (id, dunning) values (1, ${dunning({ autoBaseRate: true, baseRateSince: "2026-07" })}::jsonb)`;
    const current = await company.loadCompany();
    const input = company.companySchema.parse({ ...current, skonto: current.skonto ?? undefined, dunning: { ...current.dunning } });
    await guard.saveCompany("test-user", input, "2026-11-07");
    expect(await stored()).toMatchObject({ baseRateSince: "2026-07", autoBaseRate: true });

    await guard.saveCompany("test-user", { ...input, dunning: { ...input.dunning, baseRate: 150 } }, "2026-11-07");
    expect(await stored()).toMatchObject({ baseRate: 150, baseRateSince: null });
  });
});
