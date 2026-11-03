import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Kontakte als Kunde und Lieferant (Postgres)", () => {
  let sql: postgres.Sql;
  let contacts: typeof import("./contacts.ts");
  const actor = "test-user";
  const input = (name: string, roles: { isCustomer?: boolean; isSupplier?: boolean; lieferantennummer?: string } = {}) => ({
    kundennummer: "",
    name,
    strasse: "",
    plz: "",
    ort: "",
    land: "DE",
    email: "",
    ustId: "",
    iban: "",
    leitwegId: "",
    defaultFormat: null,
    ...roles,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    contacts = await import("./contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
  });

  it("legt ohne Angabe einen Kunden an, wie bisher", async () => {
    expect(await contacts.createContact(actor, input("Nordwerk"))).toMatchObject({ isCustomer: true, isSupplier: false, lieferantennummer: null });
  });

  it("speichert Lieferant und beide Rollen, mit Lieferantennummer in den Versionen", async () => {
    const lieferant = await contacts.createContact(actor, input("Hetzner Online GmbH", { isCustomer: false, isSupplier: true, lieferantennummer: " L-77 " }));
    expect(lieferant).toMatchObject({ isCustomer: false, isSupplier: true, lieferantennummer: "L-77" });
    const beides = await contacts.updateContact(actor, lieferant.id, input("Hetzner Online GmbH", { isCustomer: true, isSupplier: true }));
    expect(beides).toMatchObject({ isCustomer: true, isSupplier: true, lieferantennummer: null });
    const [version] = await sql`select data from contact_versions where contact_id = ${lieferant.id} and version = 1`;
    expect(version!.data).toMatchObject({ is_supplier: true, is_customer: false, lieferantennummer: "L-77" });
  });

  it("vergibt einem reinen Lieferanten keine automatische Kundennummer", async () => {
    const numbers = await import("./customer-numbers.ts");
    await numbers.saveCustomerNumbering(actor, { format: "K-{NNNN}", next: 1 });
    const lieferant = await contacts.createContact(actor, input("Hetzner", { isCustomer: false, isSupplier: true }));
    expect(lieferant.kundennummer).toBeNull();
    expect((await contacts.createContact(actor, input("Kunde A"))).kundennummer).toBe("K-0001");
    expect((await contacts.createContact(actor, input("Beides B", { isSupplier: true }))).kundennummer).toBe("K-0002");
  });

  it("verlangt mindestens eine Rolle", async () => {
    await expect(contacts.createContact(actor, input("Niemand", { isCustomer: false, isSupplier: false }))).rejects.toThrow(/Kunde oder Lieferant/);
  });

  it("listet nach Rolle", async () => {
    await contacts.createContact(actor, input("Kunde A"));
    await contacts.createContact(actor, input("Lieferant B", { isCustomer: false, isSupplier: true }));
    await contacts.createContact(actor, input("Beides C", { isSupplier: true }));
    expect((await contacts.listContacts(false, "lieferant")).map((c) => c.name)).toEqual(["Beides C", "Lieferant B"]);
    expect((await contacts.listContacts(false, "kunde")).map((c) => c.name)).toEqual(["Beides C", "Kunde A"]);
    expect(await contacts.listContacts()).toHaveLength(3);
  });
});
