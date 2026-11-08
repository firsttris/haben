import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("DATEV-Debitor und -Kreditor am Kontakt (Postgres, #327)", () => {
  let sql: postgres.Sql;
  let contacts: typeof import("./contacts.ts");
  const actor = "test-user";
  const input = (name: string, extra: Record<string, unknown> = {}) => ({
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
    await sql`truncate contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
  });

  it("trägt an einem Kontakt mit beiden Rollen Debitor und Kreditor, unabhängig von Kunden- und Lieferantennummer", async () => {
    const partner = await contacts.createContact(
      actor,
      input("Musterpartner GmbH", { kundennummer: "K-42", isSupplier: true, lieferantennummer: "L-7", debitorNr: 10042, kreditorNr: 70087 }),
    );
    expect(partner).toMatchObject({ kundennummer: "K-42", lieferantennummer: "L-7", debitorNr: 10042, kreditorNr: 70087 });
    const [version] = await sql`select data from contact_versions where contact_id = ${partner.id} and version = 1`;
    expect(version!.data).toMatchObject({ debitor_nr: 10042, kreditor_nr: 70087 });
  });

  it("lässt ohne Angabe beide Nummern leer und behält sie beim Speichern ohne die Felder", async () => {
    const ohne = await contacts.createContact(actor, input("Nordwerk"));
    expect(ohne).toMatchObject({ debitorNr: null, kreditorNr: null });
    const mit = await contacts.updateContact(actor, ohne.id, input("Nordwerk", { debitorNr: 10001 }));
    expect(mit.debitorNr).toBe(10001);
    // Ein Aufruf ohne das Feld (REST-API, ältere Formulare) lässt die Nummer stehen
    expect((await contacts.updateContact(actor, ohne.id, input("Nordwerk GmbH"))).debitorNr).toBe(10001);
    // null löscht sie ausdrücklich
    expect((await contacts.updateContact(actor, ohne.id, input("Nordwerk GmbH", { debitorNr: null }))).debitorNr).toBeNull();
  });

  it("lehnt Nummern außerhalb der DATEV-Bereiche ab", async () => {
    await expect(contacts.createContact(actor, input("A", { debitorNr: 70087 }))).rejects.toThrow(/Debitor: 10000 bis 69999/);
    await expect(contacts.createContact(actor, input("B", { isSupplier: true, kreditorNr: 10042 }))).rejects.toThrow(/Kreditor: 70000 bis 99999/);
    expect(contacts.contactSchema.safeParse(input("C", { debitorNr: 1004 })).success).toBe(false);
  });

  it("vergibt jede Nummer nur einmal und sagt, welcher Kontakt sie hat", async () => {
    await contacts.createContact(actor, input("Erster", { debitorNr: 10042 }));
    await expect(contacts.createContact(actor, input("Zweiter", { debitorNr: 10042 }))).rejects.toThrow("Debitor 10042 hat schon „Erster“.");
    const lieferant = await contacts.createContact(actor, input("Lieferant", { isCustomer: false, isSupplier: true, kreditorNr: 70087 }));
    const anderer = await contacts.createContact(actor, input("Anderer", { isCustomer: false, isSupplier: true }));
    await expect(contacts.updateContact(actor, anderer.id, input("Anderer", { isCustomer: false, isSupplier: true, kreditorNr: 70087 }))).rejects.toThrow(
      "Kreditor 70087 hat schon „Lieferant“.",
    );
    // Der Kontakt selbst darf seine Nummer beim Speichern behalten
    expect(
      (await contacts.updateContact(actor, lieferant.id, input("Lieferant KG", { isCustomer: false, isSupplier: true, kreditorNr: 70087 }))).kreditorNr,
    ).toBe(70087);
  });

  it("schützt Eindeutigkeit und Bereich auch in der Datenbank", async () => {
    await contacts.createContact(actor, input("Erster", { debitorNr: 10042 }));
    await expect(sql`insert into contacts (name, debitor_nr) values ('Direkt', 10042)`).rejects.toThrow(/contacts_debitor_nr_unique/);
    await expect(sql`insert into contacts (name, debitor_nr) values ('Direkt', 70000)`).rejects.toThrow(/contacts_debitor_nr_bereich/);
    await expect(sql`insert into contacts (name, kreditor_nr) values ('Direkt', 69999)`).rejects.toThrow(/contacts_kreditor_nr_bereich/);
  });
});
