import { generateKeyPairSync } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Die Auswahl der Store-Gesellschaft (Einstellungen › Bank) bietet nur an, was sich auch speichern lässt: Kunden im Ausland.
 * Ein schon gewählter Kontakt bleibt sichtbar, auch wenn er die Rolle Kunde inzwischen nicht mehr hat.
 */

const p8 = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe.skipIf(!testDatabaseUrl)("Kontakte zur Auswahl der Store-Gesellschaft (Postgres)", () => {
  let stores: typeof import("./index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    stores = await import("./index.ts");
    // Ohne Netz: der Zugang wird gegen Attrappen geprüft
    stores.setStoreClientFactories({
      googleplay: () => ({ listEarnings: async () => [], download: async () => new Uint8Array() }),
      appstore: () => ({ financeDetail: async () => null }),
    });
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate store_connections, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
    await stores.saveStoreConnection(actor, {
      store: "appstore",
      issuerId: "57246542-96fe-1a63-e053-0824d011072a",
      keyId: "2X9R4HXF34",
      vendorNumber: "85012345",
      privateKey: p8,
      fetchFrom: "2026-10",
    });
  });

  const kontakt = async (name: string, land: string, rolle: "kunde" | "lieferant" | "beides") => {
    const [row] = await sql`insert into contacts (name, land, is_customer, is_supplier)
      values (${name}, ${land}, ${rolle !== "lieferant"}, ${rolle !== "kunde"}) returning id`;
    return row!.id as string;
  };

  it("bietet Kunden im Ausland an, keinen reinen Lieferanten und keinen Kontakt in Deutschland, und alle lassen sich speichern", async () => {
    await kontakt("Apple Distribution International Ltd", "IE", "kunde");
    await kontakt("Hosting Irland Ltd", "IE", "lieferant");
    await kontakt("Beides Ltd", "IE", "beides");
    await kontakt("Inland GmbH", "DE", "kunde");
    const choices = await stores.storeContactChoices();
    expect(choices.map((c) => c.name)).toEqual(["Apple Distribution International Ltd", "Beides Ltd"]);
    for (const c of choices) await expect(stores.setStoreContact(actor, { store: "appstore", contactId: c.id })).resolves.toBeUndefined();
  });

  it("lässt einen schon gewählten Kontakt sichtbar und speicherbar, auch wenn er kein Kunde mehr ist", async () => {
    const apple = await kontakt("Apple Distribution International Ltd", "IE", "beides");
    await stores.setStoreContact(actor, { store: "appstore", contactId: apple });
    await sql`update contacts set is_customer = false where id = ${apple}`;
    await kontakt("Hosting Irland Ltd", "IE", "lieferant");
    const choices = await stores.storeContactChoices();
    expect(choices.map((c) => c.name)).toEqual(["Apple Distribution International Ltd"]);
    await expect(stores.setStoreContact(actor, { store: "appstore", contactId: apple })).resolves.toBeUndefined();
  });
});
