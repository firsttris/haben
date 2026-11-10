import { generateKeyPairSync } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppStoreClient, GooglePlayClient } from "@haben/import";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const p8 = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const serviceAccountJson = JSON.stringify({ type: "service_account", client_email: "haben@projekt.iam.gserviceaccount.com", private_key: rsa });

const ISSUER = "57246542-96fe-1a63-e053-0824d011072a";
const TODAY = new Date("2026-11-10T10:00:00Z");

/** Nachgebaute Stores: Google mit Berichten im Bucket, Apple mit Berichten je Fiskalmonat */
const fake = {
  google: new Map<string, Uint8Array>([
    ["earnings/earnings_202608_1-1.zip", new Uint8Array([0x50, 0x4b, 3, 4, 8])],
    ["earnings/earnings_202609_1-1.zip", new Uint8Array([0x50, 0x4b, 3, 4, 9])],
    ["earnings/earnings_202610_1-1.zip", new Uint8Array([0x50, 0x4b, 3, 4, 10])],
    ["earnings/earnings_202610_1-2.zip", new Uint8Array([0x50, 0x4b, 3, 4, 11])],
  ]),
  apple: new Map<string, Uint8Array>([
    ["2026-07", new Uint8Array([0x1f, 0x8b, 7])],
    ["2026-09", new Uint8Array([0x1f, 0x8b, 9])],
  ]),
  appleCalls: [] as string[],
  googleFails: false,
};

const googleClient: GooglePlayClient = {
  async listEarnings() {
    if (fake.googleFails) throw new Error("Zugriff abgelehnt: does not have storage.objects.list access");
    return [...fake.google.keys()].map((name) => ({ name, month: `${name.slice(18, 22)}-${name.slice(22, 24)}`, size: 5 }));
  },
  async download(name) {
    return fake.google.get(name)!;
  },
};

const appleClient: AppStoreClient = {
  async financeDetail(month) {
    fake.appleCalls.push(month);
    return fake.apple.get(month) ?? null;
  },
};

describe.skipIf(!testDatabaseUrl)("Finanzberichte der App-Stores (Postgres)", () => {
  let stores: typeof import("./index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    stores = await import("./index.ts");
    stores.setStoreClientFactories({ googleplay: () => googleClient, appstore: () => appleClient });
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("speichert den Google-Zugang verschlüsselt, ohne den Schlüssel in Zusammenfassung und Audit-Log", async () => {
    await stores.saveStoreConnection(actor, { store: "googleplay", bucket: "gs://pubsite_prod_rev_0123/", serviceAccountJson, fetchFrom: "2026-09" });
    const [summary] = await stores.storeConnectionsSummary();
    expect(summary).toMatchObject({
      store: "googleplay",
      config: { store: "googleplay", bucket: "pubsite_prod_rev_0123", clientEmail: "haben@projekt.iam.gserviceaccount.com" },
      fetchFrom: "2026-09",
      reports: 0,
    });
    expect(JSON.stringify(summary)).not.toContain("PRIVATE KEY");
    const [row] = await sql`select ciphertext::text as c from store_connections`;
    expect(row!.c).not.toContain("PRIVATE");
    const audit = await sql`select coalesce(new_value, old_value)::text as d from audit_log where table_name = 'store_connections'`;
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.map((a) => a.d).join()).not.toContain("ciphertext");
  });

  it("lehnt einen Zugang ab, den Google nicht annimmt, und behält den alten", async () => {
    fake.googleFails = true;
    await expect(
      stores.saveStoreConnection(actor, { store: "googleplay", bucket: "pubsite_prod_rev_9999", serviceAccountJson, fetchFrom: "2026-09" }),
    ).rejects.toThrow(/Google Play lehnt den Zugang ab/);
    fake.googleFails = false;
    const [summary] = await stores.storeConnectionsSummary();
    expect(summary!.config).toMatchObject({ bucket: "pubsite_prod_rev_0123" });
  });

  it("archiviert jeden Google-Bericht ab dem gewählten Monat genau einmal, auch mehrteilige Monate", async () => {
    const first = await stores.syncStore(actor, "googleplay", TODAY);
    expect(first.error).toBeNull();
    expect(first.added.map((r) => r.filename)).toEqual(["earnings_202609_1-1.zip", "earnings_202610_1-1.zip", "earnings_202610_1-2.zip"]);

    const again = await stores.syncStore(actor, "googleplay", TODAY);
    expect(again.added).toEqual([]);

    const files = await sql`select kind, year, filename, mime_type, note from archive_files order by filename`;
    expect(files).toHaveLength(3);
    expect(files[0]).toMatchObject({ kind: "storebericht", year: 2026, mime_type: "application/zip", note: "Google Play, Finanzbericht 2026-09" });
    const reports = await sql`select store, report_kind, period, part from store_reports order by period, part`;
    expect(reports.map((r) => `${r.report_kind} ${r.period} ${r.part}`)).toEqual([
      "earnings 2026-09 earnings/earnings_202609_1-1.zip",
      "earnings 2026-10 earnings/earnings_202610_1-1.zip",
      "earnings 2026-10 earnings/earnings_202610_1-2.zip",
    ]);
    const [summary] = await stores.storeConnectionsSummary();
    expect(summary).toMatchObject({ reports: 3, latestPeriod: "2026-10", lastError: null });
  });

  it("hält Berichte unveränderlich", async () => {
    await expect(sql`update store_reports set period = '2026-01'`).rejects.toThrow();
    await expect(sql`delete from store_reports`).rejects.toThrow();
  });

  it("fragt Apple je Fiskalmonat bis zum Vormonat und gibt Monate ohne Bericht nach drei Monaten auf", async () => {
    await stores.saveStoreConnection(actor, {
      store: "appstore",
      issuerId: ISSUER,
      keyId: "2X9R4HXF34",
      vendorNumber: "85012345",
      privateKey: p8,
      fetchFrom: "2026-06",
    });
    fake.appleCalls.length = 0;
    const result = await stores.syncStore(actor, "appstore", TODAY);
    expect(result.error).toBeNull();
    // Der Probeabruf beim Speichern zählt nicht mit; abgefragt wird Juni bis Oktober
    expect(fake.appleCalls).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(result.added.map((r) => r.filename)).toEqual(["apple_finance_detail_Z1_85012345_2026-07.txt.gz", "apple_finance_detail_Z1_85012345_2026-09.txt.gz"]);

    // Juni ist älter als drei Monate und bleibt ohne Bericht; August und Oktober werden weiter gefragt
    const [connection] = await sql`select to_char(fetch_from, 'YYYY-MM-DD') as f from store_connections where store = 'appstore'`;
    expect(connection!.f).toBe("2026-08-01");

    fake.apple.set("2026-10", new Uint8Array([0x1f, 0x8b, 10]));
    fake.appleCalls.length = 0;
    const next = await stores.syncStore(actor, "appstore", TODAY);
    expect(fake.appleCalls).toEqual(["2026-08", "2026-10"]);
    expect(next.added.map((r) => r.period)).toEqual(["2026-10"]);
    const [archived] = await sql`select mime_type from archive_files where filename like 'apple%2026-10%'`;
    expect(archived!.mime_type).toBe("application/gzip");
  });

  it("vermerkt Fehler am Zugang; der automatische Abruf wartet danach einen Tag", async () => {
    fake.googleFails = true;
    const now = new Date("2026-11-12T08:00:00Z");
    const summary = await stores.runDueStoreSyncs(now);
    expect(summary.synced).toBe(2);
    expect(summary.errors).toEqual(["Google Play: Abruf fehlgeschlagen: Zugriff abgelehnt: does not have storage.objects.list access"]);
    const [google] = (await stores.storeConnectionsSummary()).filter((c) => c.store === "googleplay");
    expect(google!.lastError).toContain("Zugriff abgelehnt");

    const later = await stores.runDueStoreSyncs(new Date("2026-11-12T20:00:00Z"));
    expect(later.synced).toBe(0);
    fake.googleFails = false;
  });

  it("protokolliert den automatischen Abruf unter system:storeabruf", async () => {
    const rows = await sql`select distinct actor from audit_log where table_name = 'store_reports'`;
    expect(rows.map((r) => r.actor).sort()).toEqual(["test-user"]);
    const sync = await sql`select distinct actor from audit_log where table_name = 'store_connections' and actor like 'system:%'`;
    expect(sync.map((r) => r.actor)).toEqual(["system:storeabruf"]);
  });

  it("entfernt einen Zugang und lässt die Berichte im Archiv", async () => {
    await stores.deleteStoreConnection(actor, "googleplay");
    expect((await stores.storeConnectionsSummary()).map((c) => c.store)).toEqual(["appstore"]);
    const [count] = await sql`select count(*)::int as n from store_reports where store = 'googleplay'`;
    expect(count!.n).toBe(3);
  });
});
