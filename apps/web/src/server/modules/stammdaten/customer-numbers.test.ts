import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Kundennummern (Postgres)", () => {
  let sql: postgres.Sql;
  let contacts: typeof import("./contacts.ts");
  let numbers: typeof import("./customer-numbers.ts");
  const actor = "test-user";
  const input = (name: string, kundennummer = "") => ({
    kundennummer,
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
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    contacts = await import("./contacts.ts");
    numbers = await import("./customer-numbers.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
  });

  it("vergibt ohne Format keine Nummer, wie bisher", async () => {
    expect((await contacts.createContact(actor, input("Nordwerk"))).kundennummer).toBeNull();
    expect(await numbers.customerNumbering()).toEqual({ format: "", next: 1, preview: null });
  });

  it("vergibt im Format fortlaufend, eine eingetragene Nummer bleibt und zählt nicht mit", async () => {
    await numbers.saveCustomerNumbering(actor, { format: "K-{NNNN}", next: 1 });
    expect((await contacts.createContact(actor, input("A"))).kundennummer).toBe("K-0001");
    expect((await contacts.createContact(actor, input("B", "10001"))).kundennummer).toBe("10001");
    expect((await contacts.createContact(actor, input("C"))).kundennummer).toBe("K-0002");
    expect(await numbers.customerNumbering()).toEqual({ format: "K-{NNNN}", next: 3, preview: "K-0003" });
  });

  it("vergibt beim Bearbeiten keine Nummer", async () => {
    const created = await contacts.createContact(actor, input("A"));
    await numbers.saveCustomerNumbering(actor, { format: "K-{NNNN}", next: 1 });
    expect((await contacts.updateContact(actor, created.id, input("A neu"))).kundennummer).toBeNull();
  });

  it("überspringt Nummern, die schon ein Kontakt hat", async () => {
    await contacts.createContact(actor, input("Alt", "K-0001"));
    await contacts.createContact(actor, input("Alt 2", "K-0002"));
    await numbers.saveCustomerNumbering(actor, { format: "K-{NNNN}", next: 1 });
    expect((await contacts.createContact(actor, input("Neu"))).kundennummer).toBe("K-0003");
  });

  it("vergibt auch gleichzeitig jede Nummer nur einmal", async () => {
    await numbers.saveCustomerNumbering(actor, { format: "{NNN}", next: 1 });
    const created = await Promise.all(Array.from({ length: 6 }, (_, i) => contacts.createContact(actor, input(`K${i}`))));
    expect(created.map((c) => c.kundennummer).sort()).toEqual(["001", "002", "003", "004", "005", "006"]);
  }, 30_000);

  it("lehnt ungültige Formate ab; leer schaltet die Vergabe ab", async () => {
    await expect(numbers.saveCustomerNumbering(actor, { format: "K {NNNN}", next: 1 })).rejects.toThrow(/Buchstaben, Ziffern/);
    await expect(numbers.saveCustomerNumbering(actor, { format: "K-", next: 1 })).rejects.toThrow(/laufende Nummer/);
    await expect(numbers.saveCustomerNumbering(actor, { format: "K-{NNNN}", next: 0 })).rejects.toThrow(/mindestens 1/);
    await numbers.saveCustomerNumbering(actor, { format: "K-{NNNN}", next: 50 });
    expect((await contacts.createContact(actor, input("A"))).kundennummer).toBe("K-0050");
    await numbers.saveCustomerNumbering(actor, { format: "  ", next: 51 });
    expect((await contacts.createContact(actor, input("B"))).kundennummer).toBeNull();
  });
});
