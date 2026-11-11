import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/* Stundensatz am Kontakt (#417): Vorgabe für neue Leistungseinträge, in Cent; leer = keiner hinterlegt, fehlt = unverändert. */

describe.skipIf(!testDatabaseUrl)("Stundensatz am Kontakt (Postgres, #417)", () => {
  let sql: postgres.Sql;
  let contacts: typeof import("./contacts.ts");
  const actor = "test-user";
  const input = (extra: Record<string, unknown> = {}) => ({
    kundennummer: "",
    name: "Nordwerk GmbH",
    strasse: "",
    plz: "",
    ort: "",
    land: "DE",
    email: "",
    ustId: "",
    iban: "",
    leitwegId: "",
    defaultFormat: null,
    ...extra,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    contacts = await import("./contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
  });

  it("speichert den Satz in Cent, lässt ihn bei fehlender Angabe stehen und löscht ihn mit null", async () => {
    const created = await contacts.createContact(actor, input({ hourlyRateCents: 9500 }));
    expect(created.hourlyRateCents).toBe(9500);
    expect((await contacts.updateContact(actor, created.id, input())).hourlyRateCents).toBe(9500);
    expect((await contacts.updateContact(actor, created.id, input({ hourlyRateCents: 10000 }))).hourlyRateCents).toBe(10000);
    expect((await contacts.updateContact(actor, created.id, input({ hourlyRateCents: null }))).hourlyRateCents).toBeNull();
  });

  it("ohne Angabe ist keiner hinterlegt", async () => {
    expect((await contacts.createContact(actor, input())).hourlyRateCents).toBeNull();
  });

  it("lehnt einen negativen oder gebrochenen Satz ab", () => {
    expect(contacts.contactSchema.safeParse(input({ hourlyRateCents: -1 })).success).toBe(false);
    expect(contacts.contactSchema.safeParse(input({ hourlyRateCents: 95.5 })).success).toBe(false);
  });
});
